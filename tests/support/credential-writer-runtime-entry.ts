// Test-only Worker entry: runs createAdminCredentialWriter (and the credential reader,
// to observe the result) inside workerd against a loopback HTTP fixture backend.
// Bindings arrive as wrangler vars with fictitious values. Responses carry only version
// numbers and codes — never a key, hash, cookie or backend text; nothing is logged.
import { createAdminCredentialReader } from "@/cloudflare/admin/credential-reader";
import { AdminCredentialWriterError, createAdminCredentialWriter } from "@/cloudflare/admin/credential-writer";
import { GOLDEN_PBKDF2_HASH, MALFORMED_HASH } from "./legacy-password-verifier-fixtures";

interface RuntimeEnv {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
}

const HASHES: Record<string, string> = {
  golden: GOLDEN_PBKDF2_HASH,
  other: MALFORMED_HASH, // any non-empty string is fine for a writer; the format is the verifier's concern
  empty: "",
  huge: "x".repeat(2000),
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const runtimeEntry = {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ status: "ok" });

    if (url.pathname === "/replace") {
      const hash = HASHES[url.searchParams.get("hash") ?? ""];
      if (hash === undefined) return json({ error: "bad_request" }, 400);
      // Passed through unparsed by design: "abc" or "1.5" must reach the writer as NaN/1.5.
      const expected = Number(url.searchParams.get("expected"));
      const bindings = url.searchParams.get("config") === "no-key"
        ? { SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: "" }
        : { SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY };
      try {
        const version = await createAdminCredentialWriter(bindings).replacePasswordHash(hash, expected);
        return json({ ok: true, version });
      } catch (error) {
        return json({ ok: false, code: error instanceof AdminCredentialWriterError ? error.code : "unexpected_error" });
      }
    }

    if (url.pathname === "/state") {
      try {
        const state = await createAdminCredentialReader({
          SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY,
        })();
        return json({ ok: true, hasHash: state.passwordHash !== null, version: state.sessionVersion });
      } catch {
        return json({ ok: false });
      }
    }

    return json({ error: "not_found" }, 404);
  },
};

export default runtimeEntry;
