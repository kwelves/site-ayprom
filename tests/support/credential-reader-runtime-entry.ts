// Test-only Worker entry: runs createAdminCredentialReader (alone and under the
// legacy verifier) inside real workerd against a loopback fixture backend.
// Responses carry only booleans and codes — never a key, hash, password or state.
import { AdminCredentialReaderError, createAdminCredentialReader } from "@/cloudflare/admin/credential-reader";
import { LegacyPasswordVerifierError, createLegacyPasswordVerifier } from "@/cloudflare/admin/legacy-password-verifier";
import { FIXTURE_ENV_PASSWORD, FIXTURE_WRONG_PASSWORD, GOLDEN_HASH_PASSWORD } from "./legacy-password-verifier-fixtures";

interface ReaderTestEnv {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
}

const PASSWORDS: Record<string, string> = {
  env: FIXTURE_ENV_PASSWORD,
  golden: GOLDEN_HASH_PASSWORD,
  wrong: FIXTURE_WRONG_PASSWORD,
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function errorCode(error: unknown): string {
  if (error instanceof AdminCredentialReaderError || error instanceof LegacyPasswordVerifierError) return error.code;
  return "unexpected_error";
}

const runtimeEntry = {
  async fetch(request: Request, env: ReaderTestEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ status: "ok" });
    const read = createAdminCredentialReader({ SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY });

    if (url.pathname === "/state") {
      const expectVersion = Number(url.searchParams.get("expectVersion"));
      try {
        const state = await read();
        return json({ ok: true, hasHash: state.passwordHash !== null, versionMatches: state.sessionVersion === expectVersion });
      } catch (error) {
        return json({ ok: false, error: errorCode(error) });
      }
    }

    if (url.pathname === "/verify") {
      const password = PASSWORDS[url.searchParams.get("password") ?? ""];
      if (password === undefined) return json({ error: "bad_request" }, 400);
      let envRead = false;
      const verifier = createLegacyPasswordVerifier({
        readCredentialState: read,
        readEnvPassword: () => {
          envRead = true;
          return FIXTURE_ENV_PASSWORD;
        },
      });
      try {
        return json({ ok: true, result: await verifier.verifyPassword(password), envRead });
      } catch (error) {
        return json({ ok: false, error: errorCode(error), envRead });
      }
    }

    return json({ error: "not_found" }, 404);
  },
};

export default runtimeEntry;
