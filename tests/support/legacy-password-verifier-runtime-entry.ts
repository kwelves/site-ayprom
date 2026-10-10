// Test-only Worker entry: runs createLegacyPasswordVerifier inside real workerd.
// Responses carry only booleans and error codes — never a password, hash or state.
import {
  LegacyPasswordVerifierError,
  createLegacyPasswordVerifier,
  type LegacyCredentialState,
} from "@/cloudflare/admin/legacy-password-verifier";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_UNICODE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
  MALFORMED_HASH,
} from "./legacy-password-verifier-fixtures";

interface Probe {
  state: LegacyCredentialState | "outage";
  env: string | undefined;
  password: string;
  method?: "verifyPassword" | "credentialVersion";
}

const EMPTY_ROW: LegacyCredentialState = { passwordHash: null, sessionVersion: 1 };
const HASH_ROW: LegacyCredentialState = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 7 };

const PROBES: Record<string, Probe> = {
  "env-correct": { state: EMPTY_ROW, env: FIXTURE_ENV_PASSWORD, password: FIXTURE_ENV_PASSWORD },
  "env-wrong": { state: EMPTY_ROW, env: FIXTURE_ENV_PASSWORD, password: FIXTURE_WRONG_PASSWORD },
  "env-unicode": { state: EMPTY_ROW, env: FIXTURE_UNICODE_ENV_PASSWORD, password: FIXTURE_UNICODE_ENV_PASSWORD },
  "env-unicode-nfd": { state: EMPTY_ROW, env: FIXTURE_UNICODE_ENV_PASSWORD, password: FIXTURE_UNICODE_ENV_PASSWORD.normalize("NFD") },
  "env-short": { state: EMPTY_ROW, env: "short", password: "short" },
  "hash-golden-correct": { state: HASH_ROW, env: FIXTURE_ENV_PASSWORD, password: GOLDEN_HASH_PASSWORD },
  "hash-golden-env-password": { state: HASH_ROW, env: FIXTURE_ENV_PASSWORD, password: FIXTURE_ENV_PASSWORD },
  "hash-malformed": { state: { passwordHash: MALFORMED_HASH, sessionVersion: 2 }, env: FIXTURE_ENV_PASSWORD, password: FIXTURE_ENV_PASSWORD },
  "reader-outage": { state: "outage", env: FIXTURE_ENV_PASSWORD, password: FIXTURE_ENV_PASSWORD },
  "version": { state: HASH_ROW, env: undefined, password: "", method: "credentialVersion" },
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function runProbe(probe: Probe) {
  let envRead = false;
  const verifier = createLegacyPasswordVerifier({
    readCredentialState: async () => {
      if (probe.state === "outage") throw new Error("simulated backend outage");
      return probe.state;
    },
    readEnvPassword: () => {
      envRead = true;
      return probe.env;
    },
  });
  try {
    const result = probe.method === "credentialVersion"
      ? await verifier.credentialVersion()
      : await verifier.verifyPassword(probe.password);
    return { ok: true, result, envRead };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof LegacyPasswordVerifierError ? error.code : "unexpected_error",
      envRead,
    };
  }
}

// Raw runtime capability, independent of the adapter: can this workerd derive
// PBKDF2-SHA256 at the given iteration count? Only a boolean and error name leave.
async function pbkdf2Capability(iterations: number) {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("capability-probe"), "PBKDF2", false, ["deriveBits"]);
    await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(16), iterations }, key, 256);
    return { supported: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      supported: false,
      errorName: error instanceof Error ? error.name : "unknown",
      mentionsIterationLimit: /iteration/i.test(message),
    };
  }
}

const runtimeEntry = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ status: "ok" });
    if (url.pathname === "/pbkdf2") {
      const iterations = Number(url.searchParams.get("iterations"));
      if (![100_000, 100_001, 600_000].includes(iterations)) return json({ error: "bad_request" }, 400);
      return json(await pbkdf2Capability(iterations));
    }
    if (url.pathname === "/probe") {
      const probe = PROBES[url.searchParams.get("case") ?? ""];
      if (!probe) return json({ error: "unknown_case" }, 404);
      return json(await runProbe(probe));
    }
    return json({ error: "not_found" }, 404);
  },
};

export default runtimeEntry;
