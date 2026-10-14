import { createHash } from "node:crypto";
import type { CatalogCaptureReceipt, CatalogCaptureRequest } from "./catalog-publication-capture";
import type { CatalogPublicationExport } from "./catalog-publication-export";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export class PinnedBuildPreparationError extends Error {
  constructor() {
    super("Pinned build unavailable");
    this.name = "PinnedBuildPreparationError";
  }
}

export async function preparePinnedCatalogBuild(input: {
  expectedRevision: number;
  identity: { releaseId: string; capability: string };
  capture: (request: CatalogCaptureRequest) => Promise<CatalogCaptureReceipt>;
  exportRelease: (receipt: CatalogCaptureReceipt, capability: string) => Promise<CatalogPublicationExport>;
  write: (publication: CatalogPublicationExport) => Promise<{ path: string; sha256: string; releaseId: string }>;
}): Promise<{ revision: number; releaseId: string; publicationSha256: string;
  file: { path: string; sha256: string; releaseId: string } }> {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || !UUID.test(input.identity?.releaseId) || typeof input.identity.capability !== "string"
    || input.identity.capability.length < 32 || input.identity.capability.length > 256
    || typeof input.capture !== "function" || typeof input.exportRelease !== "function"
    || typeof input.write !== "function") throw new PinnedBuildPreparationError();
  try {
    const request = { expectedRevision: input.expectedRevision, releaseId: input.identity.releaseId,
      capabilityHash: createHash("sha256").update(input.identity.capability).digest("hex") };
    const receipt = await input.capture(request);
    if (receipt.releaseId !== request.releaseId || receipt.revision !== request.expectedRevision
      || !HASH.test(receipt.sha256) || !Number.isSafeInteger(receipt.documentCount)
      || receipt.documentCount < 0 || receipt.documentCount > 20_000) throw new PinnedBuildPreparationError();
    const publication = await input.exportRelease(receipt, input.identity.capability);
    if (publication.releaseId !== receipt.releaseId || publication.revision !== receipt.revision
      || publication.sha256 !== receipt.sha256 || publication.documentCount !== receipt.documentCount) {
      throw new PinnedBuildPreparationError();
    }
    const file = await input.write(publication);
    if (file.releaseId !== receipt.releaseId || !HASH.test(file.sha256) || !file.path) {
      throw new PinnedBuildPreparationError();
    }
    return { revision: receipt.revision, releaseId: receipt.releaseId,
      publicationSha256: receipt.sha256, file };
  } catch { throw new PinnedBuildPreparationError(); }
}
