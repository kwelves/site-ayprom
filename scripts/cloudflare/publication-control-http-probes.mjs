import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Only a disposable database with the fixed local API/owned container is accepted.
export async function probePublicationControl({ apiUrl, publicKey, privateKey, projectId, localSql, root }) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  assert.match(projectId, /^ayprom-catalog-[a-f0-9]{10}$/);
  register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
  const { createPublicationControlClient } = await import(pathToFileURL(
    path.join(root, "src/cloudflare/publication/publication-control.ts")).href);
  const old = "60000000-0000-4000-8000-000000000001";
  const next = "60000000-0000-4000-8000-000000000002";
  const other = "60000000-0000-4000-8000-000000000003";
  const token = "70000000-0000-4000-8000-000000000001";
  const releaseSha256 = "a".repeat(64);
  const revision = Number(localSql("select public.get_content_revision();").trim());
  assert.ok(Number.isSafeInteger(revision) && revision > 0);
  let checks = 0;
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, apiUrl);
    checks++;
    const response = await fetch(url, init);
    const text = await response.clone().text();
    for (const secret of [privateKey, token]) assert.ok(!text.includes(secret), "control response leaked credential");
    return response;
  };
  const client = createPublicationControlClient({ SUPABASE_URL: apiUrl, PUBLICATION_SUPABASE_KEY: privateKey }, fetcher);
  const receipt = { releaseId: next, revision, releaseSha256, leaseToken: token };
  const sessions = [];
  function hold(sql) {
    const child = spawn("docker", ["exec", "-i", `supabase_db_${projectId}`, "psql",
      "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let accept, reject;
    const ready = new Promise((resolve, fail) => { accept = resolve; reject = fail; });
    let text = "";
    child.stdout.on("data", (chunk) => { text += chunk.toString(); if (text.includes("publication_control_held")) accept(); });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {});
    child.once("error", () => reject(new Error("publication_control_session_failed")));
    const finished = new Promise((resolve) => child.once("close", (code) => {
      reject(new Error("publication_control_session_closed")); resolve(code);
    }));
    const timer = setTimeout(() => { reject(new Error("publication_control_session_timeout")); child.kill(); }, 25_000);
    void finished.finally(() => clearTimeout(timer));
    child.stdin.write(`set statement_timeout='15s'; set idle_in_transaction_session_timeout='20s'; begin;\n${sql}\n\\echo publication_control_held\n`);
    const handle = { ready, finished, release: () => { if (!child.stdin.destroyed) child.stdin.end("rollback;\n"); } };
    sessions.push(handle);
    return handle;
  }
  try {
    localSql(`insert into catalog_private.catalog_releases(id,revision,sha256,capability_hash,state) values
      ('${old}',${Math.max(0,revision-1)},repeat('c',64),repeat('d',64),'ready'),
      ('${next}',${revision},repeat('a',64),repeat('b',64),'sealed'),
      ('${other}',${Math.max(0,revision-2)},repeat('e',64),repeat('f',64),'ready');
      insert into catalog_private.catalog_publication_active(singleton,release_id) values(true,'${old}')
        on conflict(singleton) do update set release_id=excluded.release_id;
      insert into public.publication_jobs(singleton,lease_revision,lease_token,lease_until)
        values(true,${revision},'${token}',clock_timestamp()+interval '10 minutes')
        on conflict(singleton) do update set lease_revision=excluded.lease_revision,
          lease_token=excluded.lease_token,lease_until=excluded.lease_until;`);
    const headers = { apikey: publicKey, "content-type": "application/json" };
    if (publicKey.startsWith("eyJ")) headers.authorization = `Bearer ${publicKey}`;
    for (const [name, body] of [
      ["read_publication_control", {}],
      ["mark_catalog_publication_ready", { expected_revision: revision, release_id: next, release_sha256: releaseSha256, lease_token: token }],
      ["compare_and_set_catalog_publication", { expected_release_id: old, next_release_id: next }],
    ]) {
      const response = await fetcher(new URL("/rest/v1/rpc/" + name, apiUrl), {
        method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
      assert.ok([401,403,404].includes(response.status), "public control must be denied");
    }
    assert.equal((await client.current()).releaseId, old);
    assert.equal(await client.markReady({ ...receipt, releaseSha256: "c".repeat(64) }), false);
    const leaseLock = hold("select singleton from public.publication_jobs where singleton for update;");
    await leaseLock.ready;
    assert.equal(await client.markReady(receipt), false, "busy lease must not mark readiness");
    assert.equal(localSql(`select state from catalog_private.catalog_releases where id='${next}';`).trim(), "sealed");
    leaseLock.release(); assert.equal(await leaseLock.finished, 0);
    assert.equal(await client.markReady(receipt), true);
    assert.equal((await client.current()).releaseId, old, "ready is not activation");
    const pointerLock = hold("select pg_advisory_xact_lock(hashtextextended('ayprom-publication-pointer',482914));");
    await pointerLock.ready;
    assert.equal(await client.compareAndSet(old,next), false, "foreign pointer operation must not be overwritten");
    pointerLock.release(); assert.equal(await pointerLock.finished, 0);
    const competing = await Promise.all([client.compareAndSet(old,next), client.compareAndSet(old,other)]);
    assert.equal(competing.filter(Boolean).length, 1, "only one expected-pointer CAS may win");
    const winner = (await client.current()).releaseId;
    assert.ok([next,other].includes(winner));
    assert.equal(await client.compareAndSet(winner,old), true, "compensation can restore old ready release");
    assert.equal((await client.current()).releaseId, old);
    assert.equal(localSql(`select count(*) from catalog_private.catalog_releases where id in ('${old}','${next}','${other}');`).trim(), "3");
    return { ok: true, checks, concurrencyChecks: 3, realNodePort: true };
  } finally {
    for (const handle of sessions) handle.release();
    await Promise.all(sessions.map((handle) => handle.finished));
    localSql("update public.publication_jobs set lease_revision=null,lease_token=null,lease_until=null;");
  }
}
