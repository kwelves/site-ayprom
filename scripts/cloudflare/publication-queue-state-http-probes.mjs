import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Runs only against the contract gate's own disposable database.
export async function probePublicationQueueState({ apiUrl, publicKey, privateKey, projectId, localSql, root }) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  assert.match(projectId, /^ayprom-catalog-[a-f0-9]{10}$/);
  const { createPublicationQueueClient } = await import(pathToFileURL(
    path.join(root, "src/cloudflare/static-build/producer/publication-queue.ts")).href);
  const token = "71000000-0000-4000-8000-000000000001";
  const revision = Number(localSql("select public.get_content_revision();").trim());
  assert.ok(Number.isSafeInteger(revision) && revision > 0);
  const previous = localSql("select coalesce(jsonb_agg(to_jsonb(j)), '[]'::jsonb) from public.publication_jobs j;").trim();
  const headers = { apikey: publicKey, "content-type": "application/json" };
  if (publicKey.startsWith("eyJ")) headers.authorization = `Bearer ${publicKey}`;
  let checks = 0, confirmations = 0;
  const fetcher = async (url, init) => {
    assert.equal(new URL(url).origin, apiUrl);
    checks++;
    const response = await fetch(url, init);
    const text = await response.clone().text();
    for (const secret of [privateKey,token]) assert.ok(!text.includes(secret), "queue state leaked credential");
    if (new URL(url).pathname.endsWith("/confirm_publication_job")) {
      confirmations++;
      assert.equal(response.status,200);
      assert.equal(await response.json(),true);
      // The real database already committed; now simulate loss of the response.
      throw new Error("simulated_lost_confirmation_reply");
    }
    return response;
  };
  const queue = createPublicationQueueClient({ SUPABASE_URL: apiUrl, PUBLICATION_SUPABASE_KEY: privateKey },fetcher);
  try {
    localSql(`insert into public.publication_jobs(singleton) values(true) on conflict(singleton) do nothing;
      update public.publication_jobs set deployed_revision=0,deployment_identifier=null,
        lease_revision=${revision},lease_token='${token}',lease_until=clock_timestamp()+interval '5 minutes';`);
    const denied = await fetcher(new URL("/rest/v1/rpc/read_publication_job",apiUrl), {
      method: "POST", headers, body: JSON.stringify({p_token:token}),redirect:"error",signal:AbortSignal.timeout(10_000) });
    assert.ok([401,403,404].includes(denied.status));
    assert.deepEqual(await queue.state(token),{deployedRevision:0,deploymentIdentifier:null,
      leaseRevision:revision,leaseOwned:true,leaseValid:true});
    await assert.rejects(queue.confirm(token,revision,"cf:local-confirmed"),{message:"publication_queue_unavailable"});
    const updatedAt = localSql("select updated_at from public.publication_jobs;").trim();
    const confirmed = {deployedRevision:revision,deploymentIdentifier:"cf:local-confirmed",
      leaseRevision:null,leaseOwned:false,leaseValid:false};
    assert.deepEqual(await queue.state(token),confirmed);
    assert.deepEqual(await queue.state("72000000-0000-4000-8000-000000000001"),confirmed);
    assert.equal(localSql("select updated_at from public.publication_jobs;").trim(),updatedAt,"reads must not modify queue");
    assert.equal(confirmations,1,"lost reply must not retry confirmation");
    return {ok:true,checks,lostReplyCases:1,realNodePort:true};
  } finally {
    const escaped = previous.replaceAll("'","''");
    localSql(`delete from public.publication_jobs;
      insert into public.publication_jobs select * from jsonb_populate_recordset(null::public.publication_jobs,'${escaped}'::jsonb);`);
  }
}
