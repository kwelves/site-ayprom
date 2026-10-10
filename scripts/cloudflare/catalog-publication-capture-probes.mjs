// Real isolated PostgREST + concurrent PostgreSQL sessions. No mocked backend.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export async function probeCatalogCapture({ apiUrl, publicKey, privateKey, projectId, localSql, root }) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  assert.match(projectId, /^ayprom-catalog-[a-f0-9]{10}$/);
  const container = `supabase_db_${projectId}`;
  const cap = "capture-http-fixture-only-capability-2026";
  const hash = createHash("sha256").update(cap).digest("hex");
  const one = "30000000-0000-4000-8000-000000000001";
  const two = "30000000-0000-4000-8000-000000000002";
  const three = "30000000-0000-4000-8000-000000000003";
  const sessions = [];
  let checks = 0;
  async function rpc(name, body, key = publicKey) {
    const headers = { apikey: key, "content-type": "application/json" };
    if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
    const response = await fetch(`${apiUrl}/rest/v1/rpc/${name}`, { method: "POST", headers,
      body: JSON.stringify(body), redirect: "error", signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    for (const value of [privateKey, cap, hash]) assert.ok(!text.includes(value), "capture response leaked credential");
    checks++;
    return { status: response.status, value: JSON.parse(text) };
  }
  function session(sql) {
    const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); if (output.includes("capture_session_ready")) readyResolve(); });
    child.stderr.on("data", () => {}); // Test data only; never forward SQL errors.
    child.stdin.on("error", () => {});
    child.once("error", () => readyReject(new Error("capture_sql_session_failed")));
    const finished = new Promise((resolve) => child.once("close", (code) => {
      readyReject(new Error("capture_sql_session_closed")); resolve(code);
    }));
    const deadline = setTimeout(() => { readyReject(new Error("capture_sql_session_timeout")); child.kill(); }, 25_000);
    void finished.finally(() => clearTimeout(deadline));
    child.stdin.write(`set statement_timeout='15s'; set idle_in_transaction_session_timeout='20s'; begin;\n${sql}\n\\echo capture_session_ready\n`);
    const handle = { ready, finished, release: () => { if (!child.stdin.destroyed) child.stdin.end("commit;\n"); } };
    sessions.push(handle);
    return handle;
  }
  async function observed(sql) {
    const deadline = Date.now() + 7_000;
    while (Date.now() < deadline) {
      if (localSql(sql).trim() === "t") return;
      await delay(50);
    }
    throw new Error("capture_race_not_observed");
  }
  const capture = (revision, id) => rpc("capture_catalog_publication", { expected_revision: revision, release_id: id, capability_hash: hash }, privateKey);
  const read = (id) => rpc("read_catalog_publication_document", { kind: "product", key: "capture-http-product", publication_id: id, publication_capability: cap });
  const revision = async () => (await rpc("get_content_revision", {})).value;
  try {
    localSql(`insert into public.categories(slug,name,description,icon,image) values ('capture-http','HTTP category','fixture','pump','/brand/ayprom-logo.svg');
      insert into public.products(slug,name,category_slug,short_description,published) values ('capture-http-product','Before','capture-http','Before description',true);`);
    const before = await revision();
    const forbidden = await rpc("capture_catalog_publication", { expected_revision: before, release_id: one, capability_hash: hash });
    assert.ok([401, 403, 404].includes(forbidden.status), "public capture must be denied");

    // A real uncommitted source edit holds a conflicting table lock.
    const earlyWriter = session("update public.products set name='Committed edit',short_description='Committed description' where slug='capture-http-product';");
    await earlyWriter.ready;
    const busy = await capture(before, one);
    assert.equal(busy.status, 500);
    assert.equal(busy.value.message, "Catalog capture unavailable");
    assert.equal(localSql(`select count(*) from catalog_private.catalog_releases where id='${one}';`).trim(), "0");
    earlyWriter.release(); assert.equal(await earlyWriter.finished, 0);
    const after = await revision();
    assert.ok(after > before);
    assert.equal((await capture(before, one)).status, 500, "stale revision must fail");
    const sealed = await capture(after, one);
    assert.equal(sealed.status, 200);
    assert.equal((await read(one)).value.name, "Committed edit");

    // Test-only pause AFTER source locks, in a separate disposable database.
    // Inspect actual pg_locks instead of assuming a sleep overlaps the capture.
    localSql(`create function catalog_private.capture_test_pause() returns trigger language plpgsql as $$
      begin if NEW.release_id='${two}' then perform pg_advisory_xact_lock(777001); end if; return NEW; end $$;
      create trigger capture_test_pause after insert on catalog_private.catalog_release_documents for each row execute function catalog_private.capture_test_pause();`);
    const gate = session("select pg_advisory_xact_lock(777001);"); await gate.ready;
    const pending = capture(after, two);
    await observed("select exists(select 1 from pg_locks where locktype='advisory' and objid=777001 and not granted);");
    const lateWriter = session("/* catalog_capture_race_writer */ update public.products set name='Later edit',short_description='Later description' where slug='capture-http-product';");
    // Attach early: if the writer errors, do not leave an unhandled rejection.
    void lateWriter.ready.catch(() => {});
    await observed("select exists(select 1 from pg_stat_activity where query like '/* catalog_capture_race_writer */%' and wait_event_type='Lock');");
    assert.equal((await read(two)).status, 500, "partially inserted candidate is not readable");
    gate.release(); assert.equal(await gate.finished, 0);
    const captured = await pending;
    assert.equal(captured.status, 200);
    await lateWriter.ready; lateWriter.release(); assert.equal(await lateWriter.finished, 0);
    const oldDocument = await read(two);
    assert.equal(oldDocument.value.name, "Committed edit");
    assert.equal(oldDocument.value.short_description, "Committed description");
    const oldSearch = await rpc("search_catalog_products", { publication_id: two, publication_capability: cap, search_query: "committed" });
    assert.deepEqual(oldSearch.value.map((row) => row.slug), ["capture-http-product"]);
    register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
    const { exportCatalogPublication, createCatalogPublicationExportSource } = await import(pathToFileURL(path.join(root,
      "src/cloudflare/static-build/producer/catalog-publication-export.ts")).href);
    const exportSource = createCatalogPublicationExportSource({ mode: "loopback-fixture", supabaseUrl: apiUrl, publishableKey: publicKey });
    const oldExport = await exportCatalogPublication({ receipt: captured.value, capability: cap, source: exportSource });
    assert.equal(oldExport.documentCount, captured.value.documentCount);
    assert.equal(oldExport.documents.product.find((item) => item.slug === "capture-http-product")?.name, "Committed edit");
    assert.ok(!JSON.stringify(oldExport).includes(cap), "export leaked capability");
    assert.equal(localSql("select name from public.products where slug='capture-http-product';").trim(), "Later edit");
    assert.deepEqual((await capture(after, two)).value, captured.value, "lost-response retry returns same immutable receipt");

    // Run the real Node adapter via its CLI against PostgREST, not a mock.
    const latest = await revision();
    const cli = spawnSync(process.execPath, [path.join(root, "scripts/cloudflare/capture-catalog-publication.mjs"),
      "--local", "--revision", String(latest), "--release", three], {
      cwd: root, windowsHide: true, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, SUPABASE_URL: apiUrl, ADMIN_SUPABASE_KEY: privateKey, CATALOG_PUBLICATION_CAPABILITY_HASH: hash },
    });
    assert.equal(cli.status, 0, "local capture CLI failed");
    for (const value of [privateKey, cap, hash]) assert.ok(!`${cli.stdout}${cli.stderr}`.includes(value), "CLI leaked credential");
    const receipt = JSON.parse(cli.stdout);
    assert.equal(receipt.ok, true); assert.equal(receipt.revision, latest);
    assert.notEqual(receipt.sha256, captured.value.sha256);
    assert.equal((await read(three)).value.name, "Later edit");
    const newerExport = await exportCatalogPublication({ receipt, capability: cap, source: exportSource });
    assert.equal(newerExport.documents.product.find((item) => item.slug === "capture-http-product")?.name, "Later edit");
    assert.notEqual(newerExport.sha256, oldExport.sha256);
    return { ok: true, checks, races: 2, realCli: true, realPinnedExports: 2 };
  } finally {
    for (const handle of sessions) handle.release();
    await Promise.all(sessions.map((handle) => handle.finished));
    localSql("drop trigger if exists capture_test_pause on catalog_private.catalog_release_documents; drop function if exists catalog_private.capture_test_pause();");
  }
}
