// Test-only Worker entry: runs the real createAdminHandler + createLegacyPasswordVerifier
// inside workerd against an in-memory "credential row" whose changes are injected at
// exact points of the login (after the state read, or during finish). No Supabase, no
// network. Responses carry only locations, booleans and small counters — never a
// cookie value, password, hash or state.
import { createAdminHandler } from "@/cloudflare/admin/handler";
import type { AdminAuthPorts, AdminPasswordProof } from "@/cloudflare/admin/contracts";
import { createLegacyPasswordVerifier, type LegacyCredentialState } from "@/cloudflare/admin/legacy-password-verifier";
import { createSessionCodec } from "@/lib/admin/session-codec";
import {
  FIXTURE_ENV_PASSWORD,
  FIXTURE_WRONG_PASSWORD,
  GOLDEN_HASH_PASSWORD,
  GOLDEN_PBKDF2_HASH,
} from "./legacy-password-verifier-fixtures";

const ORIGIN = "https://runtime.test";
const SECRET = "login-version-proof-runtime-secret-32-bytes";
const PASSWORDS: Record<string, string> = { golden: GOLDEN_HASH_PASSWORD, env: FIXTURE_ENV_PASSWORD, wrong: FIXTURE_WRONG_PASSWORD };

type Scenario =
  | "stable" | "bump-during-verify" | "bump-during-finish" | "wrong-password"
  | "reader-outage" | "malformed-proof" | "empty-env" | "shared-env-mutation";

const HASH_V2: LegacyCredentialState = { passwordHash: GOLDEN_PBKDF2_HASH, sessionVersion: 2 };
const EMPTY_V1: LegacyCredentialState = { passwordHash: null, sessionVersion: 1 };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function bumped(state: LegacyCredentialState): LegacyCredentialState {
  return { ...state, sessionVersion: state.sessionVersion + 1 };
}

async function runScenario(scenario: Scenario, password: string) {
  let database: LegacyCredentialState = (scenario === "empty-env" || scenario === "shared-env-mutation") ? { ...EMPTY_V1 } : { ...HASH_V2 };
  let reads = 0;
  let legacyPortCalls = 0;
  const finishArgs: boolean[] = [];

  const verifier = createLegacyPasswordVerifier({
    readCredentialState: async () => {
      reads += 1;
      if (scenario === "reader-outage") throw new Error("simulated outage");
      if (scenario === "shared-env-mutation") return database;
      const snapshot = { ...database };
      // The password is changed right AFTER the verifier read its state.
      if (scenario === "bump-during-verify" && reads === 1) database = bumped(database);
      return snapshot;
    },
    readEnvPassword: () => {
      if (scenario === "shared-env-mutation") database.sessionVersion = 2;
      return FIXTURE_ENV_PASSWORD;
    },
  });

  const ports: AdminAuthPorts = {
    reserve: async () => ({ allowed: true, retryAfter: 0, reservationId: "runtime-reservation" }),
    finish: async (_id, valid) => {
      finishArgs.push(valid);
      if (scenario === "bump-during-finish") database = bumped(database);
      return 0;
    },
    verifyPassword: async (candidate) => {
      legacyPortCalls += 1;
      return verifier.verifyPassword(candidate);
    },
    verifyPasswordWithVersion:
      scenario === "malformed-proof"
        ? async () => ({ valid: true, credentialVersion: "2" }) as unknown as AdminPasswordProof
        : verifier.verifyPasswordWithVersion,
    credentialVersion: verifier.credentialVersion,
    assets: { fetch: async () => new Response("<h1>shell</h1>", { headers: { "content-type": "text/html" } }) },
    secret: SECRET,
    clientIp: "203.0.113.20",
    now: Date.now,
  };
  const handler = createAdminHandler(ports);

  const login = await handler(new Request(`${ORIGIN}/api/admin/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password }),
  }));
  const token = /admin_session=([^;]+)/.exec(login?.headers.get("set-cookie") ?? "")?.[1];
  const session = token ? await createSessionCodec(SECRET, Date.now).read(token) : null;
  const result: Record<string, unknown> = {
    status: login?.status,
    location: login?.headers.get("location"),
    cookieIssued: Boolean(token),
    cookieVersion: session?.credentialVersion ?? null,
    finishArgs,
    legacyPortCalls,
    reads,
  };

  if (token) {
    // A later password change must invalidate the freshly issued session.
    database = bumped(database);
    const later = await handler(new Request(`${ORIGIN}/admin`, { headers: { cookie: `admin_session=${token}` } }));
    result.laterAdmin = { status: later?.status, location: later?.headers.get("location") };
  }
  return result;
}

const runtimeEntry = {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ status: "ok" });
    if (url.pathname === "/scenario") {
      const scenario = url.searchParams.get("name") as Scenario;
      const password = PASSWORDS[url.searchParams.get("password") ?? ""];
      if (password === undefined) return json({ error: "bad_request" }, 400);
      return json(await runScenario(scenario, password));
    }
    return json({ error: "not_found" }, 404);
  },
};

export default runtimeEntry;
