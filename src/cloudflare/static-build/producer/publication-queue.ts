// External Node build-runner only. Never import this service-key client from
// worker.ts or a browser bundle. A claim grants exclusive local build work;
// confirm() is reserved for AFTER the hosting provider confirms promotion.
import { requestAdminJson } from "../../admin/json-request";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEPLOYMENT_ID = /^[a-zA-Z0-9._:-]{1,128}$/;
const FAILURE_CODES = new Set(["build_failed", "verification_failed", "promotion_failed"]);

export interface PublicationQueueBindings {
  SUPABASE_URL: string;
  PUBLICATION_SUPABASE_KEY: string;
}

export interface PublicationClaim {
  revision: number;
  token: string;
}

export interface PublicationQueueState {
  deployedRevision: number;
  deploymentIdentifier: string | null;
  leaseRevision: number | null;
  leaseOwned: boolean;
  leaseValid: boolean;
}

function isState(value: unknown): value is PublicationQueueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).sort().join(",") === "deployedRevision,deploymentIdentifier,leaseOwned,leaseRevision,leaseValid"
    && Number.isSafeInteger(row.deployedRevision) && (row.deployedRevision as number) >= 0
    && (row.deployedRevision === 0 ? row.deploymentIdentifier === null
      : typeof row.deploymentIdentifier === "string" && DEPLOYMENT_ID.test(row.deploymentIdentifier))
    && (row.leaseRevision === null || (Number.isSafeInteger(row.leaseRevision) && (row.leaseRevision as number) > 0))
    && typeof row.leaseOwned === "boolean" && typeof row.leaseValid === "boolean"
    && (row.leaseRevision !== null || (!row.leaseOwned && !row.leaseValid));
}

export interface PublicationQueueClient {
  /** Safe private receipt read; never returns a lease token or changes queue state. */
  state(token: string): Promise<PublicationQueueState | null>;
  claim(leaseSeconds?: number, debounceSeconds?: number): Promise<PublicationClaim | null>;
  /** Keep an active build exclusive; false means the builder must stop. */
  renew(token: string, revision: number, leaseSeconds?: number): Promise<boolean>;
  /** Call only after a deployment is confirmed live, never after a local build alone. */
  confirm(token: string, revision: number, deploymentIdentifier: string): Promise<boolean>;
  fail(token: string, errorCode: "build_failed" | "verification_failed" | "promotion_failed"): Promise<boolean>;
  /** Private operator action; do not expose directly as a public route. */
  retry(): Promise<boolean>;
}

function unavailable(): Error { return new Error("publication_queue_unavailable"); }

function privateKeyAllowed(key: string): boolean {
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return true;
  if (key.split(".").length !== 3) return false;
  try {
    const payload: unknown = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    return typeof payload === "object" && payload !== null && "role" in payload && payload.role === "service_role";
  } catch { return false; }
}

function parseBindings(bindings: PublicationQueueBindings): { base: URL; key: string } {
  try {
    const base = new URL(bindings?.SUPABASE_URL);
    const key = bindings?.PUBLICATION_SUPABASE_KEY;
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
    if (!(base.protocol === "https:" || (loopback && base.protocol === "http:"))
      || base.username || base.password || base.pathname !== "/" || base.search || base.hash
      || typeof key !== "string" || key !== key.trim() || key.length > 4096
      || !/^[\x21-\x7e]+$/.test(key) || !privateKeyAllowed(key)) throw unavailable();
    return { base, key };
  } catch { throw unavailable(); }
}

function isClaim(value: unknown): value is PublicationClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Number.isSafeInteger(candidate.revision) && (candidate.revision as number) > 0
    && typeof candidate.token === "string" && UUID.test(candidate.token);
}

export function createPublicationQueueClient(
  bindings: PublicationQueueBindings,
  fetcher: typeof fetch = fetch,
): PublicationQueueClient {
  const { base, key } = parseBindings(bindings);
  if (typeof fetcher !== "function") throw unavailable();
  const headers = new Headers({ apikey: key, "content-type": "application/json" });
  if (key.split(".").length === 3) headers.set("authorization", `Bearer ${key}`);

  async function rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    try {
      const endpoint = new URL(`/rest/v1/rpc/${name}`, base);
      const result = await requestAdminJson(endpoint, {
        method: "POST", headers, body: JSON.stringify(body),
      }, fetcher);
      if (!result.ok || result.status !== 200) throw unavailable();
      return result.payload;
    } catch { throw unavailable(); }
  }

  return {
    async state(token) {
      if (typeof token !== "string" || !UUID.test(token)) throw unavailable();
      const result = await rpc("read_publication_job", { p_token: token });
      if (result === null) return null;
      if (!isState(result)) throw unavailable();
      return { ...result };
    },
    async claim(leaseSeconds = 900, debounceSeconds = 30) {
      if (!Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1200
        || !Number.isSafeInteger(debounceSeconds) || debounceSeconds < 0 || debounceSeconds > 3600) throw unavailable();
      const result = await rpc("claim_publication_job", { p_lease_seconds: leaseSeconds, p_debounce_seconds: debounceSeconds });
      if (!Array.isArray(result) || result.length > 1) throw unavailable();
      if (result.length === 0) return null;
      if (!isClaim(result[0])) throw unavailable();
      return result[0];
    },
    async renew(token, revision, leaseSeconds = 900) {
      if (!UUID.test(token) || !Number.isSafeInteger(revision) || revision < 1
        || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1200) throw unavailable();
      const result = await rpc("renew_publication_job", {
        p_token: token, p_revision: revision, p_lease_seconds: leaseSeconds,
      });
      if (typeof result !== "boolean") throw unavailable();
      return result;
    },
    async confirm(token, revision, deploymentIdentifier) {
      if (!UUID.test(token) || !Number.isSafeInteger(revision) || revision < 1
        || !DEPLOYMENT_ID.test(deploymentIdentifier)) throw unavailable();
      const result = await rpc("confirm_publication_job", {
        p_token: token, p_revision: revision, p_deployment_identifier: deploymentIdentifier,
      });
      if (typeof result !== "boolean") throw unavailable();
      return result;
    },
    async fail(token, errorCode) {
      if (!UUID.test(token) || !FAILURE_CODES.has(errorCode)) throw unavailable();
      const result = await rpc("fail_publication_job", { p_token: token, p_error_code: errorCode });
      if (typeof result !== "boolean") throw unavailable();
      return result;
    },
    async retry() {
      const result = await rpc("retry_publication_job", {});
      if (typeof result !== "boolean") throw unavailable();
      return result;
    },
  };
}
