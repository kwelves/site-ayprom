/** Local orchestration contract. No implementation here calls Cloudflare. */
import type { ReleaseJournalInput } from "./release-journal";

export interface CloudflareVersionPort {
  uploadInactive(packageDir: string): Promise<{ versionId: string }>;
  preview(versionId: string): Promise<{ url: string }>;
  currentDeployment(): Promise<{ deploymentId: string; versionId: string }>;
  activate(versionId: string): Promise<{ deploymentId: string }>;
  rollback(versionId: string): Promise<{ deploymentId: string }>;
}

export interface Candidate {
  packageDir: string;
  releaseId: string;
  revision: number;
  releaseSha256: string;
  packageSha256: string;
}

export type InspectedPackage = { ok: false; ready: false; productionReady: false; code: string } | {
  ok: boolean;
  ready: boolean;
  productionReady: boolean;
  releaseId: string;
  revision: number;
  releaseSha256: string;
  packageSha256: string;
}

type Outcome = { ok: true; status: "inactive_verified"; versionId: string; productionReady: false }
  | { ok: false; status: "rejected" | "failed_old_live" | "unresolved"; productionReady: false };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^[A-Za-z0-9_-]{1,128}$/;

/** Uploads and checks an inactive preview only; never activates or rolls back. */
export async function stageInactiveCandidate(input: {
  candidate: Candidate;
  cloudflare: CloudflareVersionPort;
  inspectPackage: (packageDir: string) => Promise<InspectedPackage>;
  probe: (input: { url: string; versionId: string; releaseId: string }) => Promise<boolean>;
  journal: (entry: ReleaseJournalInput) => Promise<void>;
}): Promise<Outcome> {
  const c = input.candidate;
  const rejected: Outcome = { ok: false, status: "rejected", productionReady: false };
  const unresolved: Outcome = { ok: false, status: "unresolved", productionReady: false };
  if (typeof c.packageDir !== "string" || !c.packageDir || !UUID.test(c.releaseId)
    || !Number.isSafeInteger(c.revision) || c.revision < 0
    || !SHA256.test(c.releaseSha256) || !SHA256.test(c.packageSha256)) return rejected;

  let inspected: InspectedPackage;
  try { inspected = await input.inspectPackage(c.packageDir); }
  catch { return rejected; }
  if (inspected?.ok !== true || inspected.ready !== true || inspected.productionReady !== false
    || inspected.releaseId !== c.releaseId || inspected.revision !== c.revision
    || inspected.releaseSha256 !== c.releaseSha256 || inspected.packageSha256 !== c.packageSha256) {
    return rejected;
  }

  let before: { deploymentId: string; versionId: string };
  try { before = await input.cloudflare.currentDeployment(); }
  catch { return unresolved; }
  if (!VERSION.test(before?.deploymentId ?? "") || !VERSION.test(before?.versionId ?? "")) return unresolved;

  const record = async (status: ReleaseJournalInput["status"], versionId: string | null,
    reasonCode?: string): Promise<boolean> => {
    try {
      await input.journal({ status, versionId, deploymentId: before.deploymentId,
        previousVersionId: before.versionId, releaseId: c.releaseId, revision: c.revision,
        releaseSha256: c.releaseSha256, packageSha256: c.packageSha256,
        ...(reasonCode ? { reasonCode } : {}) });
      return true;
    } catch { return false; }
  };

  // The durable intent is required BEFORE an upload may have an external effect.
  // If this write fails, no upload occurred in this invocation.
  if (!await record("upload_started", null)) return rejected;

  const reconcileUnknown = async (): Promise<Outcome> => {
    try { await input.cloudflare.currentDeployment(); } catch { /* remains unresolved */ }
    await record("unresolved", null, "upload_response_unknown");
    return unresolved;
  };

  const oldStillLive = async (): Promise<Outcome> => {
    try {
      const current = await input.cloudflare.currentDeployment();
      if (current.deploymentId === before.deploymentId && current.versionId === before.versionId) {
        return { ok: false, status: "failed_old_live", productionReady: false };
      }
    } catch { /* Unknown remote state stays unknown. */ }
    return unresolved;
  };

  let uploaded: { versionId: string };
  try { uploaded = await input.cloudflare.uploadInactive(c.packageDir); }
  catch { return reconcileUnknown(); }
  const versionId = uploaded?.versionId ?? "";
  // A lost or malformed upload response may have created an inactive version.
  // Its identity must be reconciled before any retry, even if old traffic is live.
  if (!VERSION.test(versionId) || versionId === before.versionId) return reconcileUnknown();
  if (!await record("inactive_uploaded", versionId)) return unresolved;

  const failedPreview = async (): Promise<Outcome> => {
    const result = await oldStillLive();
    const recorded = await record(result.status === "failed_old_live" ? "failed_old_live" : "unresolved",
      versionId, result.status === "failed_old_live" ? "preview_failed" : "concurrent_deployment");
    return recorded ? result : unresolved;
  };
  try {
    const preview = await input.cloudflare.preview(versionId);
    if (!validPreviewUrl(preview?.url)) return failedPreview();
    const accepted = await input.probe({ url: preview.url, versionId, releaseId: c.releaseId });
    if (accepted !== true) return failedPreview();
  } catch { return failedPreview(); }

  const current = await oldStillLive();
  if (current.status !== "failed_old_live") {
    await record("unresolved", versionId, "concurrent_deployment");
    return unresolved;
  }
  if (!await record("inactive_verified", versionId)) return unresolved;
  return { ok: true, status: "inactive_verified", versionId, productionReady: false };
}

function validPreviewUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.length > 0
      && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
