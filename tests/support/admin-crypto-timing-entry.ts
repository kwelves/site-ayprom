// Test-only local workerd timing probe. It accepts no credentials from requests
// and returns only elapsed wall time plus a boolean, never passwords or hashes.
import {
  constantTimePasswordEqual,
  hashAdminPassword,
  verifyAdminPasswordHash,
} from "@/lib/admin/password-credential";
import { GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH } from "./legacy-password-verifier-fixtures";

async function measure(mode: string): Promise<Response> {
  const started = performance.now();
  let ok: boolean;
  if (mode === "env") {
    ok = await constantTimePasswordEqual(GOLDEN_HASH_PASSWORD, GOLDEN_HASH_PASSWORD);
  } else if (mode === "verify") {
    ok = await verifyAdminPasswordHash(GOLDEN_HASH_PASSWORD, GOLDEN_PBKDF2_HASH);
  } else if (mode === "hash") {
    const encoded = await hashAdminPassword(GOLDEN_HASH_PASSWORD);
    ok = encoded.startsWith("pbkdf2-sha256:600000:");
  } else {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  return Response.json({ ok, elapsedMs: performance.now() - started }, { headers: { "cache-control": "no-store" } });
}

const timingEntry = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return Response.json({ status: "ok" });
    if (url.pathname !== "/measure" || request.method !== "GET") {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    return measure(url.searchParams.get("mode") ?? "");
  },
};

export default timingEntry;
