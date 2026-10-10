// Private Node builder port. Never import this into public Next/Worker code.
// Credentials and the capability hash stay in this process; the receipt is safe
// metadata, not an export of the catalog and not permission to publish it.
import { Buffer } from "node:buffer";
import { requestAdminJson } from "../../admin/json-request";

export interface CatalogCaptureRequest {
  expectedRevision: number;
  releaseId: string;
  capabilityHash: string;
}
export interface CatalogCaptureReceipt {
  releaseId: string;
  revision: number;
  sha256: string;
  documentCount: number;
}
export interface CatalogCaptureSource {
  capture(input: CatalogCaptureRequest): Promise<unknown>;
}
export type CaptureInput = CatalogCaptureRequest & { source: CatalogCaptureSource };
type CaptureErrorCode = "capture_input_invalid" | "capture_configuration_invalid" | "capture_unavailable" | "capture_response_invalid";
export class CatalogCaptureError extends Error {
  readonly code: CaptureErrorCode;
  constructor(code: CaptureErrorCode) {
    super("Catalog capture unavailable");
    this.name = "CatalogCaptureError";
    this.code = code;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;

export async function captureCatalogPublication(input: CaptureInput): Promise<CatalogCaptureReceipt> {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
    || typeof input.releaseId !== "string" || !UUID.test(input.releaseId)
    || typeof input.capabilityHash !== "string" || !HASH.test(input.capabilityHash)
    || typeof input.source?.capture !== "function") throw new CatalogCaptureError("capture_input_invalid");
  // Freeze/copy so a port cannot change the identity we subsequently validate.
  const request = Object.freeze({ expectedRevision: input.expectedRevision, releaseId: input.releaseId, capabilityHash: input.capabilityHash });
  let value: unknown;
  try { value = await input.source.capture(request); }
  catch { throw new CatalogCaptureError("capture_unavailable"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CatalogCaptureError("capture_response_invalid");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).sort().join(",") !== "documentCount,releaseId,revision,sha256"
    || row.releaseId !== request.releaseId || row.revision !== request.expectedRevision
    || typeof row.sha256 !== "string" || !HASH.test(row.sha256)
    || !Number.isSafeInteger(row.documentCount) || (row.documentCount as number) < 0 || (row.documentCount as number) > 20_000) {
    throw new CatalogCaptureError("capture_response_invalid");
  }
  return { releaseId: row.releaseId as string, revision: row.revision as number, sha256: row.sha256, documentCount: row.documentCount as number };
}

function isPrivateKey(key: string): boolean {
  if (!key || key.length > 8192 || /[^!-~]/.test(key)) return false;
  if (key.startsWith("sb_secret_") && key.length > 10) return true;
  const parts = key.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}

export function createCatalogPublicationCaptureSource(
  bindings: { SUPABASE_URL: string; ADMIN_SUPABASE_KEY: string }, fetcher: typeof fetch = fetch,
): CatalogCaptureSource {
  let url: URL;
  const key = bindings?.ADMIN_SUPABASE_KEY;
  try {
    url = new URL(bindings?.SUPABASE_URL);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && local))
      || url.username || url.password || url.pathname !== "/" || url.search || url.hash
      || typeof key !== "string" || !isPrivateKey(key)) throw new Error();
  } catch { throw new CatalogCaptureError("capture_configuration_invalid"); }
  url.pathname = "/rest/v1/rpc/capture_catalog_publication";
  return {
    async capture(input) {
      const headers = new Headers({ apikey: key, "content-type": "application/json", accept: "application/json" });
      if (key.startsWith("eyJ")) headers.set("authorization", `Bearer ${key}`);
      const result = await requestAdminJson(url, { method: "POST", headers, body: JSON.stringify({
        expected_revision: input.expectedRevision, release_id: input.releaseId, capability_hash: input.capabilityHash,
      }) }, fetcher);
      if (result.status !== 200) throw new CatalogCaptureError("capture_unavailable");
      return result.payload;
    },
  };
}
