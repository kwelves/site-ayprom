// Private external Node orchestration only. No Next/Worker/browser entry point.
import { stageInactiveCandidate, type Candidate, type CloudflareVersionPort, type InspectedPackage } from "./cloudflare-version-port";
import type { PublicationControl, PublicationIdentity } from "./publication-control";
import type { PublicationClaim, PublicationQueueClient, PublicationQueueState } from "../static-build/producer/publication-queue";
import type { createReleaseJournal, ReleaseJournalEntry, ReleaseJournalStatus } from "./release-journal";

type Deployment = { deploymentId: string; versionId: string };
type Journal = ReturnType<typeof createReleaseJournal>;
export interface PublicationProbe {
  preview(target: { url: string; versionId: string; releaseId: string; revision: number;
    releaseSha256: string; packageSha256: string }): Promise<boolean>;
  live(target: Deployment & { release: PublicationIdentity }): Promise<boolean>;
}
export interface PublishInput {
  candidate: Candidate;
  claim: PublicationClaim;
  cloudflare: CloudflareVersionPort;
  control: PublicationControl;
  queue: Pick<PublicationQueueClient, "state" | "renew" | "confirm" | "fail">;
  probe: PublicationProbe;
  journal: Journal;
  inspectPackage(path: string): Promise<InspectedPackage>;
  /** Optional gate: every immutable media object the release references must exist before readiness.
   * Anything but an explicit complete success keeps the old release live. */
  verifyMedia?(releaseId: string): Promise<{ ok: boolean; missing: string[] }>;
}
export type PublicationOutcome = { ok: boolean; status: "published" | "failed_old_live" | "unresolved"; productionReady: false };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9._:-]{1,128}$/;
const terminal = new Set(["published", "rolled_back", "failed_old_live"]);
const outcome = (status: PublicationOutcome["status"]): PublicationOutcome =>
  ({ ok: status === "published", status, productionReady: false });
const unidentified = () => outcome("unresolved");
function identity(value: unknown): value is PublicationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "releaseId,releaseSha256,revision"
    && typeof row.releaseId === "string" && UUID.test(row.releaseId)
    && Number.isSafeInteger(row.revision) && (row.revision as number) >= 0
    && typeof row.releaseSha256 === "string" && HASH.test(row.releaseSha256);
}
function deployment(value: unknown): value is Deployment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "deploymentId,versionId"
    && typeof row.deploymentId === "string" && ID.test(row.deploymentId)
    && typeof row.versionId === "string" && ID.test(row.versionId);
}
function equalRelease(a: PublicationIdentity | null, b: PublicationIdentity): boolean {
  return !!a && a.releaseId === b.releaseId && a.revision === b.revision && a.releaseSha256 === b.releaseSha256;
}
function equalDeployment(a: Deployment, b: Deployment): boolean {
  return a.deploymentId === b.deploymentId && a.versionId === b.versionId;
}
function validQueue(value: PublicationQueueState | null): value is PublicationQueueState {
  return !!value && Number.isSafeInteger(value.deployedRevision) && value.deployedRevision >= 0
    && (value.deployedRevision === 0 ? value.deploymentIdentifier === null
      : typeof value.deploymentIdentifier === "string" && ID.test(value.deploymentIdentifier))
    && (value.leaseRevision === null || (Number.isSafeInteger(value.leaseRevision) && value.leaseRevision > 0))
    && typeof value.leaseOwned === "boolean" && typeof value.leaseValid === "boolean"
    && (value.leaseRevision !== null || (!value.leaseOwned && !value.leaseValid));
}
function flowValid(records: ReleaseJournalEntry[]): boolean {
  let phase: ReleaseJournalStatus | undefined;
  const next: Partial<Record<ReleaseJournalStatus, ReleaseJournalStatus>> = {
    candidate_created: "upload_started", upload_started: "inactive_uploaded", inactive_uploaded: "inactive_verified",
    inactive_verified: "ready_started", ready_started: "ready_verified", ready_verified: "activation_started",
    activation_started: "activation_verified", activation_verified: "pointer_started", pointer_started: "pointer_verified",
    pointer_verified: "live_verified", live_verified: "confirmation_started", confirmation_started: "published",
    rollback_started: "rollback_verified", rollback_verified: "pointer_restore_started", pointer_restore_started: "rolled_back",
  };
  const beforeActivation = new Set<ReleaseJournalStatus | undefined>([undefined, "candidate_created", "upload_started",
    "inactive_uploaded", "inactive_verified", "ready_started", "ready_verified", "activation_started", "failed_old_live"]);
  const canRollback = new Set<ReleaseJournalStatus | undefined>(["activation_verified", "pointer_started",
    "pointer_verified", "live_verified", "confirmation_started"]);
  for (const row of records) {
    if (row.status === "unresolved") continue;
    if (row.status === "failed_old_live" && beforeActivation.has(phase)) { phase = row.status; continue; }
    if (row.status === "rollback_started" && canRollback.has(phase)) { phase = row.status; continue; }
    if (row.status === "rolled_back" && (phase === "rollback_verified" || phase === "rolled_back")) { phase = row.status; continue; }
    if (phase === row.status && terminal.has(row.status)) continue;
    if ((phase === undefined && row.status === "candidate_created") || (phase && next[phase] === row.status)) {
      phase = row.status; continue;
    }
    return false;
  }
  return true;
}

/** Unknown effects are reconciled once against actual state, never blindly retried.
 * A restart restores an unconfirmed attempt rather than re-running activation or
 * confirmation. Ports still require independently verified remote execution gates.
 */
export async function publishCandidate(input: PublishInput): Promise<PublicationOutcome> {
  const c = input?.candidate, claim = input?.claim;
  if (!c || typeof c.packageDir !== "string" || !c.packageDir.trim() || c.packageDir.length > 4096
    || typeof c.releaseId !== "string" || !UUID.test(c.releaseId)
    || !Number.isSafeInteger(c.revision) || c.revision < 1
    || typeof c.releaseSha256 !== "string" || !HASH.test(c.releaseSha256)
    || typeof c.packageSha256 !== "string" || !HASH.test(c.packageSha256)
    || !claim || claim.revision !== c.revision || typeof claim.token !== "string" || !UUID.test(claim.token)) return unidentified();
  try {
    return await input.journal.exclusive(async () => {
      const history = await input.journal.read();
      const latest = new Map<string, ReleaseJournalEntry>();
      for (const row of history) latest.set(row.releaseId, row);
      if ([...latest.values()].some(row => row.releaseId !== c.releaseId && !terminal.has(row.status))) return unidentified();
      const records = history.filter(row => row.releaseId === c.releaseId);
      if (records.some(row => row.revision !== c.revision || row.releaseSha256 !== c.releaseSha256
        || row.packageSha256 !== c.packageSha256) || !flowValid(records)) return unidentified();

      const candidateRelease: PublicationIdentity = { releaseId: c.releaseId, revision: c.revision, releaseSha256: c.releaseSha256 };
      const readHosting = async (): Promise<Deployment> => {
        const result = await input.cloudflare.currentDeployment();
        if (!deployment(result)) throw new Error("publication_state_unavailable");
        return result;
      };
      const readPointer = async (): Promise<PublicationIdentity | null> => {
        const result = await input.control.current();
        if (result !== null && !identity(result)) throw new Error("publication_state_unavailable");
        return result;
      };
      const readQueue = async (): Promise<PublicationQueueState> => {
        const result = await input.queue.state(claim.token);
        if (!validQueue(result)) throw new Error("publication_state_unavailable");
        return result;
      };
      let previous: PublicationIdentity, before: Deployment;
      if (records.length) {
        const first = records[0];
        if (!identity(first.previousRelease) || !first.previousDeploymentId || !first.previousVersionId
          || first.previousRelease.releaseId === c.releaseId) return unidentified();
        previous = first.previousRelease;
        before = { deploymentId: first.previousDeploymentId, versionId: first.previousVersionId };
        if (!deployment(before) || records.some(row => !equalRelease(row.previousRelease ?? null, previous)
          || row.previousDeploymentId !== before.deploymentId || row.previousVersionId !== before.versionId)) return unidentified();
      } else {
        const pointer = await readPointer();
        if (!identity(pointer) || pointer.releaseId === c.releaseId || pointer.revision >= c.revision) return unidentified();
        previous = pointer; before = await readHosting();
      }
      let versionId: string | null = records.find(row => row.status === "inactive_uploaded")?.versionId ?? null;
      let activeId = before.deploymentId;
      const receipt = (row: PublicationQueueState, release: PublicationIdentity, deploymentId: string) =>
        row.deployedRevision === release.revision && row.deploymentIdentifier === "cf:" + deploymentId;
      const record = async (status: ReleaseJournalStatus, reasonCode?: string) => {
        await input.journal.append({ status, releaseId: c.releaseId, revision: c.revision,
          releaseSha256: c.releaseSha256, packageSha256: c.packageSha256, versionId,
          previousVersionId: before.versionId, deploymentId: activeId,
          previousRelease: { ...previous }, previousDeploymentId: before.deploymentId,
          ...(reasonCode ? { reasonCode } : {}) });
      };
      const unknown = async (reason = "state_unavailable") => {
        try { await record("unresolved", reason); } catch { /* Earlier durable intent is retained. */ }
        return unidentified();
      };
      const verify = async (release: PublicationIdentity, target: Deployment, receiptDeploymentId: string): Promise<boolean> => {
        try {
          const matching = async () => equalDeployment(await readHosting(), target)
            && equalRelease(await readPointer(), release)
            && receipt(await readQueue(), release, receiptDeploymentId);
          if (!await matching() || await input.probe.live({ ...target, release: { ...release } }) !== true) return false;
          return await matching();
        } catch { return false; }
      };
      const ownLease = (row: PublicationQueueState) => row.leaseOwned && row.leaseValid && row.leaseRevision === c.revision;
      const releaseLease = async (): Promise<boolean> => {
        let row = await readQueue();
        if (!receipt(row, previous, before.deploymentId)) return false;
        if (ownLease(row)) {
          try { await input.queue.fail(claim.token, "promotion_failed"); } catch { /* Read actual acknowledgement. */ }
          row = await readQueue();
          if (!receipt(row, previous, before.deploymentId) || ownLease(row)) return false;
        }
        return true;
      };
      const failedOld = async (reason: string, restored = false): Promise<PublicationOutcome> => {
        const target = { deploymentId: activeId, versionId: before.versionId };
        if (!await verify(previous, target, before.deploymentId)) return unknown(reason);
        if (!await releaseLease() || !await verify(previous, target, before.deploymentId)) return unknown(reason);
        await record(restored ? "rolled_back" : "failed_old_live", reason);
        return outcome("failed_old_live");
      };
      const compensate = async (alreadyRestored = false): Promise<PublicationOutcome> => {
        let actual = await readHosting();
        let pointer = await readPointer();
        if (!versionId || !receipt(await readQueue(), previous, before.deploymentId)
          || (!equalRelease(pointer, previous) && !equalRelease(pointer, candidateRelease))) return unknown("concurrent_pointer");
        if (!alreadyRestored) {
          if (actual.versionId !== versionId || actual.deploymentId !== activeId) return unknown("concurrent_deployment");
          await record("rollback_started");
          pointer = await readPointer();
          if (!equalDeployment(await readHosting(), actual)
            || (!equalRelease(pointer, previous) && !equalRelease(pointer, candidateRelease))
            || !receipt(await readQueue(), previous, before.deploymentId)) return unknown("concurrent_deployment");
          let acknowledgement: { deploymentId: string } | undefined;
          try { acknowledgement = await input.cloudflare.rollback(before.versionId); } catch { /* Reconcile once. */ }
          actual = await readHosting();
          const acknowledged = typeof acknowledgement?.deploymentId === "string" && ID.test(acknowledgement.deploymentId);
          if (actual.versionId !== before.versionId || actual.deploymentId === activeId
            || (acknowledged && acknowledgement!.deploymentId !== actual.deploymentId)) return unknown("rollback_unknown");
          activeId = actual.deploymentId;
          await record("rollback_verified");
        } else if (actual.versionId !== before.versionId || actual.deploymentId !== activeId) {
          return unknown("concurrent_deployment");
        }
        pointer = await readPointer();
        if (equalRelease(pointer, candidateRelease)) {
          if (!equalDeployment(await readHosting(), { deploymentId: activeId, versionId: before.versionId })
            || !receipt(await readQueue(), previous, before.deploymentId)) return unknown("concurrent_deployment");
          await record("pointer_restore_started");
          if (!equalDeployment(await readHosting(), { deploymentId: activeId, versionId: before.versionId })
            || !receipt(await readQueue(), previous, before.deploymentId)) return unknown("concurrent_deployment");
          try { await input.control.compareAndSet(c.releaseId, previous.releaseId); } catch { /* Reconcile actual pointer. */ }
          if (!equalRelease(await readPointer(), previous)) return unknown("pointer_unknown");
        } else if (!equalRelease(pointer, previous)) return unknown("concurrent_pointer");
        return failedOld("live_probe_failed", true);
      };
      const resume = async (): Promise<PublicationOutcome> => {
        const actual = await readHosting(), pointer = await readPointer(), queue = await readQueue();
        const last = records.at(-1)!;
        const activation = records.findLast(row => row.status === "activation_verified");
        const restored = records.findLast(row => row.status === "rollback_verified");
        const activationStarted = records.some(row => row.status === "activation_started");
        const rollbackStarted = records.some(row => row.status === "rollback_started");
        if (last.status === "published") {
          if (!versionId) return unidentified();
          return await verify(candidateRelease, { deploymentId: last.deploymentId!, versionId }, last.deploymentId!)
            ? outcome("published") : unknown("concurrent_deployment");
        }
        if (versionId && actual.versionId === versionId) {
          if (!activationStarted || (activation && actual.deploymentId !== activation.deploymentId)) return unknown("concurrent_deployment");
          activeId = actual.deploymentId;
          if (receipt(queue, candidateRelease, activeId)) {
            if (!records.some(row => row.status === "confirmation_started")
              || !equalRelease(pointer, candidateRelease)
              || !await verify(candidateRelease, actual, activeId)) return unknown("confirmation_unknown");
            await record("published");
            return await verify(candidateRelease, actual, activeId) ? outcome("published") : unknown("concurrent_deployment");
          }
          if (!receipt(queue, previous, before.deploymentId) || rollbackStarted) return unknown("rollback_unknown");
          if (!activation) await record("activation_verified");
          return compensate();
        }
        if (actual.versionId !== before.versionId || !receipt(queue, previous, before.deploymentId)) return unknown("concurrent_deployment");
        if (rollbackStarted) {
          if (restored && actual.deploymentId !== restored.deploymentId) return unknown("concurrent_deployment");
          activeId = actual.deploymentId;
          if (!restored) await record("rollback_verified");
          if (last.status === "rolled_back") {
            return await verify(previous, actual, before.deploymentId) ? outcome("failed_old_live") : unknown();
          }
          return compensate(true);
        }
        if (!equalDeployment(actual, before) || !equalRelease(pointer, previous)) return unknown("concurrent_deployment");
        if (records.some(row => row.status === "upload_started") && !versionId) return unknown("upload_response_unknown");
        if (records.some(row => row.status === "published")) return unknown("confirmation_unknown");
        if (last.status === "failed_old_live") return failedOld("activation_unknown");
        // Seeing old traffic cannot prove that an unacknowledged request will not
        // apply later. Keep the attempt blocked until an actual new deployment
        // or independently conclusive remote operation evidence is observed.
        if (activationStarted && !activation) return unknown("activation_unknown");
        return failedOld("activation_unknown");
      };
      if (records.length) return resume();
      if (!await verify(previous, before, before.deploymentId)) return unidentified();
      if (!ownLease(await readQueue()) || await input.queue.renew(claim.token, c.revision) !== true) return failedOld("lease_lost");
      await record("candidate_created");

      const staged = await stageInactiveCandidate({ candidate: c, cloudflare: input.cloudflare,
        inspectPackage: input.inspectPackage,
        probe: target => input.probe.preview({ ...target, revision: c.revision,
          releaseSha256: c.releaseSha256, packageSha256: c.packageSha256 }),
        journal: async entry => {
          if (entry.previousVersionId !== before.versionId || entry.deploymentId !== before.deploymentId) {
            throw new Error("publication_baseline_changed");
          }
          if (entry.versionId) versionId = entry.versionId;
          await input.journal.append({ ...entry, previousRelease: { ...previous }, previousDeploymentId: before.deploymentId });
        },
      });
      if (!staged.ok) {
        if (staged.status === "unresolved") return unknown(versionId ? "state_unavailable" : "upload_response_unknown");
        return failedOld(staged.status === "rejected" ? "package_rejected" : "preview_failed");
      }
      versionId = staged.versionId;
      if (input.verifyMedia) {
        let mediaComplete = false;
        try {
          const media = await input.verifyMedia(c.releaseId);
          mediaComplete = media?.ok === true && Array.isArray(media.missing) && media.missing.length === 0;
        } catch { /* Unreadable media is treated as missing; details are never journaled. */ }
        if (!mediaComplete) return failedOld("media_missing");
      }
      await record("ready_started");
      let ready = false;
      try { ready = await input.control.markReady({ ...candidateRelease, leaseToken: claim.token }) === true; }
      catch { /* Readiness does not change traffic; unused releases are retained. */ }
      if (!ready) return failedOld("ready_failed");
      await record("ready_verified");

      const inspected = await input.inspectPackage(c.packageDir);
      if (inspected.ok !== true || inspected.ready !== true || inspected.productionReady !== false
        || inspected.releaseId !== c.releaseId || inspected.revision !== c.revision
        || inspected.releaseSha256 !== c.releaseSha256 || inspected.packageSha256 !== c.packageSha256) return failedOld("package_rejected");
      if (await input.queue.renew(claim.token, c.revision) !== true || !ownLease(await readQueue())) return failedOld("lease_lost");
      if (!await verify(previous, before, before.deploymentId)) return unknown("concurrent_deployment");
      await record("activation_started");
      if (!await verify(previous, before, before.deploymentId) || !ownLease(await readQueue())) {
        return unknown("concurrent_deployment");
      }
      let acknowledgement: { deploymentId: string } | undefined;
      try { acknowledgement = await input.cloudflare.activate(versionId); } catch { /* Reconcile once, never activate again. */ }
      const actual = await readHosting();
      if (equalDeployment(actual, before)) return unknown("activation_unknown");
      const acknowledged = typeof acknowledgement?.deploymentId === "string" && ID.test(acknowledgement.deploymentId);
      if (actual.versionId !== versionId || (acknowledged && acknowledgement!.deploymentId !== actual.deploymentId)) {
        return unknown("concurrent_deployment");
      }
      activeId = actual.deploymentId;
      await record("activation_verified");
      if (!equalRelease(await readPointer(), previous) || !receipt(await readQueue(), previous, before.deploymentId)
        || !equalDeployment(await readHosting(), actual)) {
        return unknown("concurrent_pointer");
      }
      await record("pointer_started");
      if (!equalDeployment(await readHosting(), actual)
        || !receipt(await readQueue(), previous, before.deploymentId)) return unknown("concurrent_deployment");
      try { await input.control.compareAndSet(previous.releaseId, c.releaseId); } catch { /* Read actual pointer once. */ }
      const switched = await readPointer();
      if (equalRelease(switched, previous)) return compensate();
      if (!equalRelease(switched, candidateRelease)) return unknown("concurrent_pointer");
      await record("pointer_verified");
      const target = { deploymentId: activeId, versionId };
      // Queue receipt is still the previous deployment until confirmation.
      const verifyUnconfirmed = async () => {
        const matching = async () => equalDeployment(await readHosting(), target)
          && equalRelease(await readPointer(), candidateRelease)
          && receipt(await readQueue(), previous, before.deploymentId);
        try {
          return await matching() && await input.probe.live({ ...target, release: { ...candidateRelease } }) === true && await matching();
        } catch { return false; }
      };
      if (!await verifyUnconfirmed()) return compensate();
      await record("live_verified");
      if (await input.queue.renew(claim.token, c.revision) !== true || !ownLease(await readQueue())) return compensate();
      if (!equalDeployment(await readHosting(), target) || !equalRelease(await readPointer(), candidateRelease)) return unknown("concurrent_deployment");
      await record("confirmation_started");
      if (!await verifyUnconfirmed() || !ownLease(await readQueue())) return compensate();
      try { await input.queue.confirm(claim.token, c.revision, "cf:" + activeId); } catch { /* A lost reply is not a failed commit. */ }
      const confirmation = await readQueue();
      if (receipt(confirmation, candidateRelease, activeId)) {
        if (!await verify(candidateRelease, target, activeId)) return unknown("confirmation_unknown");
        await record("published");
        return await verify(candidateRelease, target, activeId) ? outcome("published") : unknown("concurrent_deployment");
      }
      if (receipt(confirmation, previous, before.deploymentId)) return compensate();
      return unknown("confirmation_unknown");
    });
  } catch { return unidentified(); }
}
