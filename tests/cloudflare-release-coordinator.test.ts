import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { publishCandidate } from "@/cloudflare/publication/release-coordinator";
import { publishPublicationPackage } from "@/cloudflare/publication/publish-publication-package";
import { writeCoordinatorFixturePackage } from "./helpers/cloudflare-publication-package-fixture.mjs";
import { createReleaseJournal, type ReleaseJournalInput } from "@/cloudflare/publication/release-journal";
import type { PublicationIdentity } from "@/cloudflare/publication/publication-control";

const roots:string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
const old = {releaseId:"40000000-0000-4000-8000-000000000001",revision:6,releaseSha256:"c".repeat(64)};
const candidate = {packageDir:"local-candidate",releaseId:"40000000-0000-4000-8000-000000000002",
  revision:7,releaseSha256:"b".repeat(64),packageSha256:"a".repeat(64)};
const token = "41000000-0000-4000-8000-000000000001";
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(),"ayprom-coordinator-")); roots.push(root);
  const journalPath = path.join(root,"release.jsonl");
  const journal = createReleaseJournal({path:journalPath});
  const state = {active:{deploymentId:"deployment-old",versionId:"version-old"},
    pointer:{...old} as PublicationIdentity|null,queue:{deployedRevision:6,deploymentIdentifier:"cf:deployment-old",
      leaseRevision:7 as number|null,leaseOwned:true,leaseValid:true}};
  const last = async () => (await journal.read()).at(-1)?.status;
  const cloudflare = {
    uploadInactive:vi.fn(async () => ({versionId:"version-new"})),
    preview:vi.fn(async () => ({url:"https://preview.example.test"})),
    currentDeployment:vi.fn(async () => ({...state.active})),
    activate:vi.fn(async (_version:string) => {
      expect(_version).toBe("version-new");
      expect(await last()).toBe("activation_started");
      state.active={deploymentId:"deployment-new",versionId:"version-new"}; return {deploymentId:"deployment-new"};
    }),
    rollback:vi.fn(async (_version:string) => {
      expect(_version).toBe("version-old");
      expect(await last()).toBe("rollback_started");
      state.active={deploymentId:"deployment-restored",versionId:"version-old"}; return {deploymentId:"deployment-restored"};
    }),
  };
  const control = {
    current:vi.fn(async () => state.pointer ? {...state.pointer}:null),
    markReady:vi.fn(async (_input:PublicationIdentity & {leaseToken:string}) => {
      expect(_input).toEqual({releaseId:candidate.releaseId,revision:7,releaseSha256:candidate.releaseSha256,leaseToken:token});
      expect(await last()).toBe("ready_started"); return true;
    }),
    compareAndSet:vi.fn(async (expected:string|null,next:string) => {
      expect(await last()).toBe(next===candidate.releaseId ? "pointer_started":"pointer_restore_started");
      if (state.pointer?.releaseId!==expected) return false;
      state.pointer=next===candidate.releaseId ? {releaseId:candidate.releaseId,revision:7,releaseSha256:candidate.releaseSha256}:{...old};
      return true;
    }),
  };
  const queue = {
    state:vi.fn(async (_token:string) => { expect(_token).toBe(token); return {...state.queue}; }),
    renew:vi.fn(async (_token:string,_revision:number) => {
      expect(_token).toBe(token);expect(_revision).toBe(7);return state.queue.leaseOwned && state.queue.leaseValid;
    }),
    confirm:vi.fn(async (_token:string,revision:number,identifier:string) => {
      expect(_token).toBe(token);
      expect(await last()).toBe("confirmation_started");
      state.queue={deployedRevision:revision,deploymentIdentifier:identifier,leaseRevision:null,leaseOwned:false,leaseValid:false}; return true;
    }),
    fail:vi.fn(async (_token:string,_code:"build_failed"|"verification_failed"|"promotion_failed") => {
      expect(_token).toBe(token);expect(["build_failed","verification_failed","promotion_failed"]).toContain(_code);
      state.queue.leaseRevision=null; state.queue.leaseOwned=false;state.queue.leaseValid=false; return true;
    }),
  };
  const probe = {
    preview:vi.fn(async (_target:{url:string;versionId:string;releaseId:string}) => {
      expect(_target).toMatchObject({url:"https://preview.example.test",versionId:"version-new",releaseId:candidate.releaseId});return true;
    }),
    live:vi.fn(async (target:{deploymentId:string;versionId:string;release:PublicationIdentity}) =>
      target.deploymentId===state.active.deploymentId && target.versionId===state.active.versionId
      && target.release.releaseId===state.pointer?.releaseId),
  };
  const inspectPackage=vi.fn(async (_path:string) => {
    expect(_path).toBe(candidate.packageDir);return {...candidate,ok:true,ready:true,productionReady:false};
  });
  return {candidate:{...candidate},claim:{token,revision:7},cloudflare,control,queue,probe,inspectPackage,journal,journalPath,state};
}
function oldUnchanged(f:ReturnType<typeof fixture>) {
  expect(f.state.active.versionId).toBe("version-old");
  expect(f.state.pointer).toEqual(old); expect(f.state.queue.deployedRevision).toBe(6);
  expect(f.queue.confirm).not.toHaveBeenCalled();
}
function failAppend(f:ReturnType<typeof fixture>,status:string) {
  const real=f.journal.append.bind(f.journal);
  return vi.spyOn(f.journal,"append").mockImplementation(async (entry) => {
    if (entry.status===status) throw new Error("private-storage-error");
    return real(entry);
  });
}
describe("durable release coordinator", () => {
  it("publishes in order with durable intents before each external mutation",async () => {
    const f=fixture();
    expect(await publishCandidate(f)).toEqual({ok:true,status:"published",productionReady:false});
    expect((await f.journal.read()).map(e=>e.status)).toEqual(["candidate_created","upload_started","inactive_uploaded",
      "inactive_verified","ready_started","ready_verified","activation_started","activation_verified","pointer_started",
      "pointer_verified","live_verified","confirmation_started","published"]);
    expect(f.state.queue).toMatchObject({deployedRevision:7,deploymentIdentifier:"cf:deployment-new",leaseOwned:false});
    expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);expect(f.queue.confirm).toHaveBeenCalledTimes(1);
    expect(f.cloudflare.rollback).not.toHaveBeenCalled();
    expect((await f.journal.read()).every(e=>e.previousRelease?.releaseId===old.releaseId)).toBe(true);
    expect(JSON.stringify(await f.journal.read())).not.toContain(token);
  });
  it("rejects malformed candidates before remote calls",async () => {
    const f=fixture();expect((await publishCandidate({...f,candidate:{...candidate,revision:NaN}})).status).toBe("unresolved");
    expect(f.cloudflare.currentDeployment).not.toHaveBeenCalled();expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("keeps old live when real package inspection fails",async () => {
    const f=fixture();f.inspectPackage.mockResolvedValue({ok:false,ready:false,productionReady:false} as never);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("stops a stale initial lease before upload",async () => {
    const f=fixture();f.queue.renew.mockResolvedValue(false);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("does not mutate an unverified baseline",async () => {
    const f=fixture();f.probe.live.mockResolvedValue(false);
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.queue.fail).not.toHaveBeenCalled();
    expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("does not mutate when the pointer read fails",async () => {
    const f=fixture();f.control.current.mockRejectedValue(new Error("database-secret"));
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("never releases a valid foreign lease",async () => {
    const f=fixture();f.state.queue.leaseOwned=false;
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.queue.fail).not.toHaveBeenCalled();expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("keeps unknown upload unknown on replay and never reuploads",async () => {
    const f=fixture();f.cloudflare.uploadInactive.mockRejectedValue(new Error("upload-secret"));
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.cloudflare.uploadInactive).toHaveBeenCalledTimes(1);expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("fails preview without touching activation or readiness",async () => {
    const f=fixture();f.probe.preview.mockResolvedValue(false);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.control.markReady).not.toHaveBeenCalled();expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("detects another operator during preview",async () => {
    const f=fixture();f.probe.preview.mockImplementation(async()=>{f.state.active={deploymentId:"foreign",versionId:"foreign"};return true;});
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.cloudflare.activate).not.toHaveBeenCalled();expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it.each(["false","lost"])("readiness failure %s leaves old live",async mode=>{
    const f=fixture();f.control.markReady.mockImplementation(async()=>{if(mode==="lost")throw new Error("ready-secret");return false;});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("checks the lease again immediately before activation",async()=>{
    const f=fixture();f.queue.renew.mockResolvedValueOnce(true).mockResolvedValue(false);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("rejects changed package bytes after inactive verification",async()=>{
    const f=fixture();f.inspectPackage.mockResolvedValueOnce({...candidate,ok:true,ready:true,productionReady:false})
      .mockResolvedValue({ok:false,ready:false,productionReady:false} as never);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("reconciles lost activation reply against the actual new deployment",async()=>{
    const f=fixture();const activate=f.cloudflare.activate.getMockImplementation()!;
    f.cloudflare.activate.mockImplementation(async v=>{await activate(v);throw new Error("activation-secret");});
    expect((await publishCandidate(f)).status).toBe("published");expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);
  });
  it("keeps unacknowledged activation with old traffic unresolved, including on replay",async()=>{
    const f=fixture();f.cloudflare.activate.mockRejectedValue(new Error("activation-secret"));
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect((await publishCandidate(f)).status).toBe("unresolved");
    oldUnchanged(f);expect(f.cloudflare.rollback).not.toHaveBeenCalled();expect(f.queue.fail).not.toHaveBeenCalled();
    expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);
  });
  it("does not roll back a foreign deployment after uncertain activation",async()=>{
    const f=fixture();f.cloudflare.activate.mockImplementation(async()=>{f.state.active={deploymentId:"foreign",versionId:"foreign"};throw new Error("lost");});
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("reconciles malformed activation identity through actual state",async()=>{
    const f=fixture();const activate=f.cloudflare.activate.getMockImplementation()!;
    f.cloudflare.activate.mockImplementation(async v=>{await activate(v);return {deploymentId:"bad/id"};});
    expect((await publishCandidate(f)).status).toBe("published");expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);
  });
  it("rejects a different deployment id even if its version is the candidate",async()=>{
    const f=fixture();f.cloudflare.activate.mockImplementation(async()=>{f.state.active={deploymentId:"foreign",versionId:"version-new"};return {deploymentId:"deployment-new"};});
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it.each(["false","lost"])("compensates a pointer write %s that did not apply",async mode=>{
    const f=fixture();f.control.compareAndSet.mockImplementation(async()=>{if(mode==="lost")throw new Error("pointer-secret");return false;});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);expect(f.control.compareAndSet).toHaveBeenCalledTimes(1);
  });
  it("does not retry an applied pointer change with a lost reply",async()=>{
    const f=fixture();const cas=f.control.compareAndSet.getMockImplementation()!;
    f.control.compareAndSet.mockImplementation(async(a,b)=>{await cas(a,b);throw new Error("pointer-secret");});
    expect((await publishCandidate(f)).status).toBe("published");expect(f.control.compareAndSet).toHaveBeenCalledTimes(1);
  });
  it("leaves a foreign pointer visible as unresolved",async()=>{
    const f=fixture();f.control.compareAndSet.mockImplementation(async()=>{f.state.pointer={...old,releaseId:"40000000-0000-4000-8000-000000000003"};return false;});
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("compensates failed live verification and preserves the old cursor",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect((await f.journal.read()).at(-1)?.status).toBe("rolled_back");
    expect(f.control.compareAndSet).toHaveBeenCalledTimes(2);
  });
  it("reconciles lost rollback reply without a second rollback",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const rollback=f.cloudflare.rollback.getMockImplementation()!;
    f.cloudflare.rollback.mockImplementation(async v=>{await rollback(v);throw new Error("rollback-secret");});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);
  });
  it("does not report success when rollback did not apply",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    f.cloudflare.rollback.mockRejectedValue(new Error("rollback-secret"));
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.state.active.versionId).toBe("version-new");
    expect(f.state.pointer?.releaseId).toBe(candidate.releaseId);expect(f.queue.confirm).not.toHaveBeenCalled();
  });
  it("keeps a failed pointer restoration unresolved",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const cas=f.control.compareAndSet.getMockImplementation()!;
    f.control.compareAndSet.mockImplementation(async(a,b)=>b===old.releaseId?false:cas(a,b));
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.state.active.versionId).toBe("version-old");expect(f.state.pointer?.releaseId).toBe(candidate.releaseId);
  });
  it("recognizes pointer restoration that applied before a lost reply",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const cas=f.control.compareAndSet.getMockImplementation()!;
    f.control.compareAndSet.mockImplementation(async(a,b)=>{const applied=await cas(a,b);if(b===old.releaseId)throw new Error("lost");return applied;});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
  });
  it("recognizes confirmation committed before a lost reply",async()=>{
    const f=fixture();const confirm=f.queue.confirm.getMockImplementation()!;
    f.queue.confirm.mockImplementation(async(a,b,c)=>{await confirm(a,b,c);throw new Error("confirmation-secret");});
    expect((await publishCandidate(f)).status).toBe("published");
    expect(f.queue.confirm).toHaveBeenCalledTimes(1);expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it.each(["false","lost"])("compensates uncommitted confirmation %s once actual cursor is read",async mode=>{
    const f=fixture();f.queue.confirm.mockImplementation(async()=>{if(mode==="lost")throw new Error("confirmation-secret");return false;});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");
    expect(f.state.queue.deployedRevision).toBe(6);expect(f.state.pointer).toEqual(old);
    expect(f.queue.confirm).toHaveBeenCalledTimes(1);expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);
  });
  it("does not roll back when confirmation state cannot be read",async()=>{
    const f=fixture();const read=f.queue.state.getMockImplementation()!;
    f.queue.state.mockImplementation(async t=>{if(f.queue.confirm.mock.calls.length)throw new Error("receipt-secret");return read(t);});
    f.queue.confirm.mockRejectedValue(new Error("lost"));
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("rechecks source freshness after live verification and before confirmation",async()=>{
    const f=fixture();f.queue.renew.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValue(false);
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);
  });
  it("leaves post-confirmation verification failure unresolved without resetting the cursor",async()=>{
    const f=fixture();
    f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId || f.queue.confirm.mock.calls.length===0);
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.state.queue.deployedRevision).toBe(7);
    expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("does not activate before durable activation intent",async()=>{
    const f=fixture();failAppend(f,"activation_started");
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("recovers a confirmed release after final journal write failed, without repeating effects",async()=>{
    const f=fixture();const fault=failAppend(f,"published");
    expect((await publishCandidate(f)).status).toBe("unresolved");fault.mockRestore();
    expect((await publishCandidate(f)).status).toBe("published");
    expect(f.cloudflare.uploadInactive).toHaveBeenCalledTimes(1);expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);
    expect(f.queue.confirm).toHaveBeenCalledTimes(1);
  });
  it("compensates interrupted activation on restart rather than activating again",async()=>{
    const f=fixture();const fault=failAppend(f,"activation_verified");
    expect((await publishCandidate(f)).status).toBe("unresolved");fault.mockRestore();
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);expect(f.cloudflare.uploadInactive).toHaveBeenCalledTimes(1);
    expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);
  });
  it("compensates interrupted pointer change on restart",async()=>{
    const f=fixture();const fault=failAppend(f,"pointer_verified");
    expect((await publishCandidate(f)).status).toBe("unresolved");fault.mockRestore();
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);expect(f.queue.confirm).not.toHaveBeenCalled();
  });
  it("finishes pointer restoration after interrupted rollback without rolling back again",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const fault=failAppend(f,"rollback_verified");
    expect((await publishCandidate(f)).status).toBe("unresolved");fault.mockRestore();
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
    expect(f.cloudflare.rollback).toHaveBeenCalledTimes(1);
  });
  it("does not overwrite an operator change when replaying a published history",async()=>{
    const f=fixture();expect((await publishCandidate(f)).status).toBe("published");
    f.state.active={deploymentId:"foreign",versionId:"foreign"};
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("rejects different candidate hashes in existing history before effects",async()=>{
    const f=fixture();await publishCandidate(f);
    expect((await publishCandidate({...f,candidate:{...candidate,packageSha256:"d".repeat(64)}})).status).toBe("unresolved");
    expect(f.cloudflare.uploadInactive).toHaveBeenCalledTimes(1);
  });
  it("blocks a second publisher with a real operation lock",async()=>{
    const f=fixture();let release!:()=>void, entered!:()=>void;
    const started=new Promise<void>(r=>entered=r),waiting=new Promise<void>(r=>release=r);
    f.cloudflare.uploadInactive.mockImplementation(async()=>{entered();await waiting;return {versionId:"version-new"};});
    const first=publishCandidate(f);await started;
    try { expect((await publishCandidate(f)).status).toBe("unresolved"); }
    finally { release(); }
    expect((await first).status).toBe("published");expect(f.cloudflare.uploadInactive).toHaveBeenCalledTimes(1);
  });
  it("blocks another unfinished release history",async()=>{
    const f=fixture();
    await f.journal.append({revision:candidate.revision,releaseSha256:candidate.releaseSha256,packageSha256:candidate.packageSha256,status:"unresolved",versionId:null,
      previousVersionId:"version-old",deploymentId:"deployment-old",
      releaseId:"40000000-0000-4000-8000-000000000003"} as unknown as ReleaseJournalInput);
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("rejects an unsafe preview without probing it",async()=>{
    const f=fixture();f.cloudflare.preview.mockResolvedValue({url:"http://remote.example.test"});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");expect(f.probe.preview).not.toHaveBeenCalled();
  });
  it("keeps duplicate inactive version identity unresolved",async()=>{
    const f=fixture();f.cloudflare.uploadInactive.mockResolvedValue({versionId:"version-old"});
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.activate).not.toHaveBeenCalled();
  });
  it("requires an existing verified pointer baseline",async()=>{
    const f=fixture();f.state.pointer=null;
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("requires baseline queue receipt matching hosting and catalogue",async()=>{
    const f=fixture();f.state.queue.deploymentIdentifier="cf:unrelated";
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();
  });
  it("keeps an unobserved failure-release acknowledgement unresolved",async()=>{
    const f=fixture();f.probe.preview.mockResolvedValue(false);f.queue.fail.mockRejectedValue(new Error("fail-secret"));
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.state.active.versionId).toBe("version-old");
  });
  it("recognizes a released lease after a lost failure acknowledgement",async()=>{
    const f=fixture();f.probe.preview.mockResolvedValue(false);const fail=f.queue.fail.getMockImplementation()!;
    f.queue.fail.mockImplementation(async(a,b)=>{await fail(a,b);throw new Error("lost");});
    expect((await publishCandidate(f)).status).toBe("failed_old_live");oldUnchanged(f);
  });

  it("does not activate over an operator change after durable intent",async()=>{
    const f=fixture();const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="activation_started") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.activate).not.toHaveBeenCalled();
    expect(f.state.active.versionId).toBe("foreign");
  });
  it("does not change the pointer after hosting changed during reconciliation reads",async()=>{
    const f=fixture();const current=f.control.current.getMockImplementation()!;
    f.control.current.mockImplementation(async()=>{
      if(f.cloudflare.activate.mock.calls.length && !f.control.compareAndSet.mock.calls.length)
        f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return current();
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.control.compareAndSet).not.toHaveBeenCalled();
  });
  it("does not switch the pointer over a hosting change after pointer intent",async()=>{
    const f=fixture();const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="pointer_started") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.control.compareAndSet).not.toHaveBeenCalled();
  });
  it("does not roll back over an operator change after rollback intent",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="rollback_started") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.rollback).not.toHaveBeenCalled();
    expect(f.state.active.versionId).toBe("foreign");
  });
  it("does not restore the pointer after hosting changed at restoration intent",async()=>{
    const f=fixture();f.probe.live.mockImplementation(async t=>t.release.releaseId===old.releaseId);
    const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="pointer_restore_started") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.control.compareAndSet).toHaveBeenCalledTimes(1);
    expect(f.state.pointer?.releaseId).toBe(candidate.releaseId);
  });
  it("does not confirm after hosting changed at confirmation intent",async()=>{
    const f=fixture();const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="confirmation_started") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.queue.confirm).not.toHaveBeenCalled();
    expect(f.state.queue.deployedRevision).toBe(6);
  });


  it("detects a hosting change while saving the final published event",async()=>{
    const f=fixture();const append=f.journal.append.bind(f.journal);
    vi.spyOn(f.journal,"append").mockImplementation(async entry=>{
      const result=await append(entry);
      if(entry.status==="published") f.state.active={deploymentId:"foreign",versionId:"foreign"};
      return result;
    });
    expect((await publishCandidate(f)).status).toBe("unresolved");
    expect(f.state.queue.deployedRevision).toBe(7);expect(f.cloudflare.rollback).not.toHaveBeenCalled();
  });
  it("real Node wrapper inspects real files and ignores an injected inspector",async()=>{
    const f=fixture();
    f.candidate=await writeCoordinatorFixturePackage(path.join(path.dirname(f.journalPath),"package"),candidate);
    expect((await publishPublicationPackage({...f,journalPath:f.journalPath})).status).toBe("published");
    expect(f.inspectPackage).not.toHaveBeenCalled();expect(f.cloudflare.activate).toHaveBeenCalledTimes(1);
  });
  it("real Node wrapper rejects bytes changed after preview",async()=>{
    const f=fixture();
    f.candidate=await writeCoordinatorFixturePackage(path.join(path.dirname(f.journalPath),"package"),candidate);
    f.probe.preview.mockImplementation(async()=>{
      writeFileSync(path.join(f.candidate.packageDir,"worker.js"),"changed");
      return true;
    });
    expect((await publishPublicationPackage({...f,journalPath:f.journalPath})).status).toBe("failed_old_live");
    expect(f.cloudflare.activate).not.toHaveBeenCalled();expect(f.inspectPackage).not.toHaveBeenCalled();
  });
  it("real Node wrapper does not trust fake inspection of a missing package",async()=>{
    const f=fixture();f.candidate.packageDir=path.join(path.dirname(f.journalPath),"absent");
    expect((await publishPublicationPackage({...f,journalPath:f.journalPath})).status).toBe("failed_old_live");
    expect(f.cloudflare.uploadInactive).not.toHaveBeenCalled();expect(f.inspectPackage).not.toHaveBeenCalled();
  });

  it("checks release media after inactive verification and before readiness",async()=>{
    const f=fixture();
    const verifyMedia=vi.fn(async(releaseId:string)=>{
      expect(releaseId).toBe(candidate.releaseId);
      expect(await f.journal.read().then(rows=>rows.at(-1)?.status)).toBe("inactive_verified");
      expect(f.control.markReady).not.toHaveBeenCalled();return {ok:true,missing:[] as string[]};
    });
    expect((await publishCandidate({...f,verifyMedia})).status).toBe("published");
    expect(verifyMedia).toHaveBeenCalledTimes(1);expect(verifyMedia).toHaveBeenCalledWith(candidate.releaseId);
  });
  it.each(["missing","throws","malformed"])("keeps old live and never activates when media verification is %s",async(kind)=>{
    const f=fixture();
    const verifyMedia=vi.fn(async(releaseId:string)=>{
      expect(releaseId).toBe(candidate.releaseId);
      if(kind==="throws") throw new Error("private-bucket-detail");
      return (kind==="missing"?{ok:false,missing:["product-images/a.webp"]}:{ok:"yes"}) as never;
    });
    expect((await publishCandidate({...f,verifyMedia})).status).toBe("failed_old_live");
    oldUnchanged(f);
    expect(f.control.markReady).not.toHaveBeenCalled();expect(f.cloudflare.activate).not.toHaveBeenCalled();
    const rows=await f.journal.read();
    expect(rows.at(-1)).toMatchObject({status:"failed_old_live",reasonCode:"media_missing"});
    expect(JSON.stringify(rows)).not.toMatch(/private-bucket-detail|product-images/);
  });
  it("does not call ports when durable history is damaged",async()=>{
    const f=fixture();writeFileSync(f.journalPath,"broken");
    expect((await publishCandidate(f)).status).toBe("unresolved");expect(f.cloudflare.currentDeployment).not.toHaveBeenCalled();
  });
});
