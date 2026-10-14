// Test-only Worker entry: runs createLegacyAdminPorts + the real admin handler inside
// workerd against a loopback HTTP fixture backend (no Supabase). Bindings arrive as
// wrangler vars with fictitious values. Responses carry only locations, booleans and
// codes — never a key, cookie, password, hash or backend text; nothing is logged.
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createLegacyAdminPorts } from "@/cloudflare/admin/legacy-admin-ports";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { FIXTURE_WRONG_PASSWORD, GOLDEN_HASH_PASSWORD } from "./legacy-password-verifier-fixtures";

interface RuntimeEnv {
  SUPABASE_URL: string;
  ADMIN_SUPABASE_KEY: string;
  ADMIN_PASSWORD: string;
}

const ORIGIN = "https://runtime.test";
const SECRET = "legacy-admin-ports-runtime-secret-32-bytes";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

let issuedToken: string | null = null;
let assetFetches = 0;

function makeHandler(env: RuntimeEnv) {
  const ports = createLegacyAdminPorts({
    SUPABASE_URL: env.SUPABASE_URL,
    ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY,
    ADMIN_PASSWORD: env.ADMIN_PASSWORD,
  });
  return createAdminHandler({
    ...ports,
    assets: {
      fetch: async () => {
        assetFetches += 1;
        return new Response("<h1>shell</h1>", { headers: { "content-type": "text/html" } });
      },
    },
    secret: SECRET,
    clientIp: "203.0.113.20",
    now: Date.now,
  });
}

const runtimeEntry = {
  async fetch(request: Request, env: RuntimeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ status: "ok" });

    if (url.pathname === "/construct") {
      const bindings = url.searchParams.get("case") === "no-key"
        ? { SUPABASE_URL: env.SUPABASE_URL, ADMIN_SUPABASE_KEY: "", ADMIN_PASSWORD: env.ADMIN_PASSWORD }
        : { SUPABASE_URL: "", ADMIN_SUPABASE_KEY: env.ADMIN_SUPABASE_KEY, ADMIN_PASSWORD: env.ADMIN_PASSWORD };
      try {
        createLegacyAdminPorts(bindings);
        return json({ threw: false });
      } catch (error) {
        return json({ threw: true, message: error instanceof Error ? error.message : "unknown" });
      }
    }

    if (url.pathname === "/login") {
      const passwords: Record<string, string> = {
        env: env.ADMIN_PASSWORD, golden: GOLDEN_HASH_PASSWORD, wrong: FIXTURE_WRONG_PASSWORD,
      };
      const password = passwords[url.searchParams.get("password") ?? ""];
      if (password === undefined) return json({ error: "bad_request" }, 400);

      const response = await makeHandler(env)(new Request(`${ORIGIN}/api/admin/login`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ password }),
      }));
      const token = /admin_session=([^;]+)/.exec(response?.headers.get("set-cookie") ?? "")?.[1];
      const session = token ? await createSessionCodec(SECRET, Date.now).read(token) : null;
      // The token stays inside the Worker: it is replayed by /admin below and is
      // never part of any response.
      issuedToken = token ?? null;
      return json({
        location: response?.headers.get("location"),
        cookieIssued: Boolean(token),
        cookieVersion: session?.credentialVersion ?? null,
      });
    }

    // A protected request carrying the session the last /login issued.
    if (url.pathname === "/admin") {
      if (!issuedToken) return json({ noSession: true });
      const before = assetFetches;
      const response = await makeHandler(env)(new Request(`${ORIGIN}/admin`, {
        headers: { cookie: `admin_session=${issuedToken}` },
      }));
      return json({
        status: response?.status,
        location: response?.headers.get("location"),
        cookieCleared: (response?.headers.get("set-cookie") ?? "").includes("Max-Age=0"),
        assetFetches: assetFetches - before,
      });
    }

    return json({ error: "not_found" }, 404);
  },
};

export default runtimeEntry;
