// Private external Node coordinator only; never a Next action, Worker or browser import.
import { requestAdminJson } from "../admin/json-request";

export interface PublicationIdentity { releaseId: string; revision: number; releaseSha256: string }
export interface PublicationControl {
  current(): Promise<PublicationIdentity | null>;
  markReady(input: PublicationIdentity & { leaseToken: string }): Promise<boolean>;
  compareAndSet(expectedReleaseId: string | null, nextReleaseId: string): Promise<boolean>;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const unavailable = () => new Error("publication_control_unavailable");

function privateKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 4096 || !/^[!-~]+$/.test(value)) return false;
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
  try { return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))?.role === "service_role"; }
  catch { return false; }
}
function identity(value: unknown): value is PublicationIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "releaseId,releaseSha256,revision"
    && typeof row.releaseId === "string" && UUID.test(row.releaseId)
    && Number.isSafeInteger(row.revision) && (row.revision as number) >= 0
    && typeof row.releaseSha256 === "string" && HASH.test(row.releaseSha256);
}
export function createPublicationControlClient(bindings: {
  SUPABASE_URL: string; PUBLICATION_SUPABASE_KEY: string;
}, fetcher: typeof fetch = fetch): PublicationControl {
  let base: URL;
  const key = bindings?.PUBLICATION_SUPABASE_KEY;
  try {
    base = new URL(bindings?.SUPABASE_URL);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
    if ((base.protocol !== "https:" && !(local && base.protocol === "http:"))
      || base.username || base.password || base.pathname !== "/" || base.search || base.hash
      || !privateKey(key) || typeof fetcher !== "function") throw unavailable();
  } catch { throw unavailable(); }
  const headers = new Headers({ apikey: key, "content-type": "application/json", accept: "application/json" });
  if (key.split(".").length === 3) headers.set("authorization", `Bearer ${key}`);
  const rpc = async (name: string, body: Record<string, unknown>): Promise<unknown> => {
    try {
      const result = await requestAdminJson(new URL("/rest/v1/rpc/" + name, base),
        { method: "POST", headers, body: JSON.stringify(body) }, fetcher);
      if (result.status !== 200 || !result.ok) throw unavailable();
      return result.payload;
    } catch { throw unavailable(); }
  };
  const boolean = (value: unknown): boolean => {
    if (typeof value !== "boolean") throw unavailable();
    return value;
  };
  return {
    async current() {
      const result = await rpc("read_publication_control", {});
      if (result === null) return null;
      if (!identity(result)) throw unavailable();
      return { ...result };
    },
    async markReady(input) {
      if (!input || !UUID.test(input.releaseId) || !HASH.test(input.releaseSha256)
        || !Number.isSafeInteger(input.revision) || input.revision < 1 || !UUID.test(input.leaseToken)) throw unavailable();
      return boolean(await rpc("mark_catalog_publication_ready", { expected_revision: input.revision,
        release_id: input.releaseId, release_sha256: input.releaseSha256, lease_token: input.leaseToken }));
    },
    async compareAndSet(expectedReleaseId, nextReleaseId) {
      if ((expectedReleaseId !== null && !UUID.test(expectedReleaseId)) || !UUID.test(nextReleaseId)) throw unavailable();
      return boolean(await rpc("compare_and_set_catalog_publication", {
        expected_release_id: expectedReleaseId, next_release_id: nextReleaseId }));
    },
  };
}
