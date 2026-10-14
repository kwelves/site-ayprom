import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { register } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inspectPublicationPackage } from "./publication-package-inspector.mjs";
import { writeCoordinatorFixturePackage } from "../../tests/helpers/cloudflare-publication-package-fixture.mjs";

// Real snapshots, RPCs and durable files; Cloudflare and the integrity package
// are explicit fixtures. This helper does not verify a running Worker/browser.
export async function probePublicationCoordinator({apiUrl,publicKey,privateKey,projectId,localSql,root}) {
  assert.equal(apiUrl,"http://127.0.0.1:56421");
  assert.match(projectId,/^ayprom-catalog-[a-f0-9]{10}$/);
  register("./static-producer-loader.mjs",{parentURL:import.meta.url,data:{srcRoot:path.join(root,"src")}});
  const load = relative => import(pathToFileURL(path.join(root,"src/cloudflare",relative)).href);
  const [{createPublicationControlClient},{createPublicationQueueClient},{captureCatalogPublication,createCatalogPublicationCaptureSource},
    {createReleaseJournal},{publishCandidate},{publishPublicationPackage}] = await Promise.all([
    load("publication/publication-control.ts"),load("static-build/producer/publication-queue.ts"),
    load("static-build/producer/catalog-publication-capture.ts"),load("publication/release-journal.ts"),
    load("publication/release-coordinator.ts"),load("publication/publish-publication-package.ts"),
  ]);
  const previousJob=localSql("select coalesce(jsonb_agg(to_jsonb(j)),'[]'::jsonb) from public.publication_jobs j;").trim();
  const previousPointer=localSql("select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) from catalog_private.catalog_publication_active a;").trim();
  const originalName=JSON.parse(localSql("select to_jsonb(name) from public.products where slug='capture-http-product';").trim());
  assert.equal(typeof originalName,"string");
  const quote=value=>String(value).replaceAll("'","''");
  const secrets=[privateKey],ids=[];
  let checks=0,confirmations=0,mode=null;
  const fetcher=async(url,init)=>{
    assert.equal(new URL(url).origin,apiUrl);checks++;
    const response=await fetch(url,init);
    const text=await response.clone().text();
    for(const secret of secrets)assert.ok(!text.includes(secret),"coordinator response leaked credential");
    if(new URL(url).pathname.endsWith("/confirm_publication_job")) {
      confirmations++;
      if(mode==="lost-confirm") {
        assert.equal(response.status,200);assert.equal(await response.clone().json(),true);
        throw new Error("simulated_lost_confirmation_reply");
      }
    }
    return response;
  };
  const bindings={SUPABASE_URL:apiUrl,PUBLICATION_SUPABASE_KEY:privateKey};
  const control=createPublicationControlClient(bindings,fetcher),queue=createPublicationQueueClient(bindings,fetcher);
  const source=createCatalogPublicationCaptureSource({SUPABASE_URL:apiUrl,ADMIN_SUPABASE_KEY:privateKey},fetcher);
  const publicHeaders={apikey:publicKey,"content-type":"application/json"};
  if(publicKey.startsWith("eyJ"))publicHeaders.authorization=`Bearer ${publicKey}`;
  const readProduct=async(releaseId,capability)=>{
    const body={kind:"product",key:"capture-http-product",
      ...(releaseId?{publication_id:releaseId,publication_capability:capability}:{})};
    const response=await fetcher(new URL("/rest/v1/rpc/read_catalog_publication_document",apiUrl),{
      method:"POST",headers:publicHeaders,body:JSON.stringify(body),redirect:"error",signal:AbortSignal.timeout(10_000)});
    assert.equal(response.status,200);
    return response.json();
  };
  const capture=async()=>{
    const claim=await queue.claim(900,0);assert.ok(claim);secrets.push(claim.token);
    const capability=randomBytes(32).toString("hex");secrets.push(capability);
    const releaseId=randomUUID();
    const receipt=await captureCatalogPublication({expectedRevision:claim.revision,releaseId,
      capabilityHash:createHash("sha256").update(capability).digest("hex"),source});
    ids.push(releaseId);
    return {claim,capability,release:{releaseId,revision:receipt.revision,releaseSha256:receipt.sha256}};
  };
  const resetQueue=(revision,identifier)=>localSql(`insert into public.publication_jobs(singleton) values(true) on conflict(singleton) do nothing;
    update public.publication_jobs set deployed_revision=${revision},deployment_identifier=${identifier?"'"+quote(identifier)+"'":"null"},
    lease_revision=null,lease_token=null,lease_until=null,attempt_revision=null,attempt_count=0,retry_after=null,last_error_code=null;`);
  const results=[];
  try {
    resetQueue(0,null);
    const baseline=await capture();
    assert.equal(await control.markReady({...baseline.release,leaseToken:baseline.claim.token}),true);
    const current=await control.current();
    assert.equal(await control.compareAndSet(current?.releaseId??null,baseline.release.releaseId),true);
    // Explicit fixture setup for a locally simulated, verified prior deployment.
    assert.equal(await queue.confirm(baseline.claim.token,baseline.release.revision,"cf:fixture-baseline"),true);
    assert.equal((await readProduct()).name,originalName);
    for(const [index,scenario] of ["lost-confirm","bad-live","interrupted-activation"].entries()) {
      const oldDeployment="fixture-old-"+index,newDeployment="fixture-new-"+index;
      assert.equal(await control.compareAndSet((await control.current()).releaseId,baseline.release.releaseId),true);
      resetQueue(baseline.release.revision,"cf:"+oldDeployment);
      const name="Coordinator candidate "+index;
      localSql(`update public.products set name='${name}' where slug='capture-http-product';`);
      const captured=await capture();
      assert.ok(captured.release.revision>baseline.release.revision);
      const suffix=randomBytes(8).toString("hex");
      const candidate=await writeCoordinatorFixturePackage(path.join(root,"dist/worker-packages","coordinator-contract-"+suffix),captured.release);
      const journalPath=path.join(root,"dist/release-journals","coordinator-contract-"+suffix+".jsonl");
      let active={deploymentId:oldDeployment,versionId:"fixture-old"},uploadCalls=0,activateCalls=0,rollbackCalls=0;
      const cloudflare={
        async currentDeployment(){return {...active};},
        async uploadInactive(){uploadCalls++;return {versionId:"fixture-new"};},
        async preview(){return {url:"https://coordinator.local.invalid/preview"};},
        async activate(version){assert.equal(version,"fixture-new");activateCalls++;active={deploymentId:newDeployment,versionId:version};return {deploymentId:newDeployment};},
        async rollback(version){assert.equal(version,"fixture-old");rollbackCalls++;active={deploymentId:"fixture-rollback-"+index,versionId:version};return {deploymentId:active.deploymentId};},
      };
      const probe={
        async preview(target){
          assert.equal(target.releaseId,captured.release.releaseId);
          assert.equal(target.releaseSha256,captured.release.releaseSha256);
          assert.equal((await readProduct(captured.release.releaseId,captured.capability)).name,name);
          assert.equal((await readProduct()).name,originalName,"candidate must not leak through legacy pointer");
          assert.equal(active.versionId,"fixture-old");
          return true;
        },
        async live(target){
          if(target.deploymentId!==active.deploymentId||target.versionId!==active.versionId)return false;
          const isNew=target.release.releaseId===captured.release.releaseId;
          if(!isNew&&target.release.releaseId!==baseline.release.releaseId)return false;
          if(isNew&&scenario==="bad-live")return false;
          const expected=isNew?name:originalName;
          return (await readProduct()).name===expected;
        },
      };
      const input={candidate,claim:captured.claim,cloudflare,control,queue,probe,journalPath};
      const beforeConfirmations=confirmations;
      mode=scenario==="lost-confirm"?"lost-confirm":null;
      let result;
      if(scenario==="interrupted-activation") {
        const fileJournal=createReleaseJournal({path:journalPath});let interrupt=true;
        const journal={...fileJournal,async append(entry){
          if(interrupt&&entry.status==="activation_verified")throw new Error("simulated_interrupted_history");
          return fileJournal.append(entry);
        }};
        const first=await publishCandidate({...input,journal,inspectPackage:inspectPublicationPackage});
        assert.equal(first.status,"unresolved");assert.equal(active.versionId,"fixture-new");
        assert.equal((await control.current()).releaseId,baseline.release.releaseId);
        interrupt=false;
        result=await publishCandidate({...input,journal,inspectPackage:inspectPublicationPackage});
      } else result=await publishPublicationPackage(input);
      if(scenario==="lost-confirm") {
        assert.equal(result.status,"published");assert.equal(active.versionId,"fixture-new");
        assert.equal((await control.current()).releaseId,captured.release.releaseId);
        assert.equal((await queue.state(captured.claim.token)).deployedRevision,captured.release.revision);
        assert.equal(confirmations-beforeConfirmations,1,"lost confirmation reply must not repeat confirm");
        assert.equal((await readProduct()).name,name);assert.equal(rollbackCalls,0);
      } else {
        assert.equal(result.status,"failed_old_live");assert.equal(active.versionId,"fixture-old");
        assert.equal((await control.current()).releaseId,baseline.release.releaseId);
        assert.equal((await queue.state(captured.claim.token)).deployedRevision,baseline.release.revision);
        assert.equal(confirmations-beforeConfirmations,0);assert.equal(rollbackCalls,1);
        assert.equal((await readProduct()).name,originalName);
      }
      assert.equal(result.productionReady,false);assert.equal(uploadCalls,1);assert.equal(activateCalls,1);
      assert.equal((await readProduct(captured.release.releaseId,captured.capability)).name,name,"candidate snapshot is retained");
      assert.equal((await readProduct(baseline.release.releaseId,baseline.capability)).name,originalName,"rollback snapshot is retained");
      results.push(result.status);
      mode=null;
    }
    const retained=localSql(`select count(*) from catalog_private.catalog_releases where id in (${ids.map(id=>"'"+id+"'").join(",")});`).trim();
    assert.equal(retained,"4");
    return {ok:true,cases:3,published:results.filter(v=>v==="published").length,compensated:2,restarts:1,
      lostConfirmReplies:1,httpChecks:checks,realSnapshots:true,realNodePort:true,fixtureCloudflare:true,
      fixturePackage:true,workerVerified:false,productionReady:false};
  } finally {
    mode=null;
    localSql(`update public.products set name='${quote(originalName)}' where slug='capture-http-product';
      delete from catalog_private.catalog_publication_active;
      insert into catalog_private.catalog_publication_active select * from jsonb_populate_recordset(
        null::catalog_private.catalog_publication_active,'${quote(previousPointer)}'::jsonb);
      delete from public.publication_jobs;
      insert into public.publication_jobs select * from jsonb_populate_recordset(
        null::public.publication_jobs,'${quote(previousJob)}'::jsonb);`);
  }
}
