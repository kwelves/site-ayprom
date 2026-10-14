import { describe, expect, it, vi } from "vitest";
import { createSessionCodec } from "@/lib/admin/session-codec";
import { handleAdminRpc, type AdminRpcDeps } from "@/cloudflare/admin-worker/rpc";
import { cookies, headers } from "@/cloudflare/admin-worker/shims/next-headers";
import { notFound, redirect } from "@/cloudflare/admin-worker/shims/next-navigation";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000_000;
const ORIGIN = "https://admin.test";

async function sessionCookie(credentialVersion = 3, now = NOW) {
  return `admin_session=${await createSessionCodec(SECRET, () => now).create({ credentialVersion })}`;
}

interface CallOptions {
  cookie?: string | null;
  origin?: string | null;
  method?: string;
  headers?: Record<string, string>;
  deps?: Partial<AdminRpcDeps>;
  registry?: AdminRpcDeps["registry"];
}

async function call(name: string, body: unknown, over: CallOptions = {}) {
  const requestHeaders: Record<string, string> = { "content-type": "application/json", ...over.headers };
  if (over.origin !== null) requestHeaders.origin = over.origin ?? ORIGIN;
  const cookie = over.cookie === undefined ? await sessionCookie() : over.cookie;
  if (cookie) requestHeaders.cookie = cookie;
  const method = over.method ?? "POST";
  const request = new Request(`${ORIGIN}/api/admin/rpc/${name}`, {
    method,
    headers: requestHeaders,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
  return handleAdminRpc(request, name, {
    registry: over.registry ?? { echo: async (...args: unknown[]) => args },
    secret: SECRET,
    now: () => NOW,
    credentialVersion: async () => 3,
    ...over.deps,
  });
}

describe("admin RPC core", () => {
  it("runs a registered action with decoded arguments and returns its value without caching", async () => {
    const response = await call("echo", { args: [1, "two", { three: 3 }] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.json()).toEqual({ ok: true, value: [1, "two", { three: 3 }] });
  });

  it("decodes FormData and undefined placeholders and rejects any other tagged object shape", async () => {
    const seen: unknown[] = [];
    const registry = { form: async (...args: unknown[]) => { seen.push(...args); return null; } };
    await call("form", { args: [{ $undefined: true }, { $formData: [["a", "1"], ["a", "2"], ["b", "x"]] }] }, { registry });
    expect(seen[0]).toBeUndefined();
    const data = seen[1] as FormData;
    expect(data.getAll("a")).toEqual(["1", "2"]);
    expect(data.get("b")).toBe("x");
    const bad = await call("form", { args: [{ $formData: [["a", 5]] }] }, { registry });
    expect(bad.status).toBe(400);
    const extra = await call("form", { args: [{ $formData: [], other: 1 }] }, { registry });
    expect(extra.status).toBe(400);
  });

  it("rebuilds uploaded files (even the empty one an untouched file input sends) as real File objects", async () => {
    const seen: FormData[] = [];
    const registry = { upload: async (form: FormData) => { seen.push(form); return null; } };
    const base64 = btoa("PNGDATA");
    const response = await call("upload", { args: [{ $formData: [
      ["name", "Gates"],
      ["logo", { $file: { name: "logo.png", type: "image/png", base64 } }],
      ["spare", { $file: { name: "", type: "application/octet-stream", base64: "" } }],
    ] }] }, { registry });
    expect(response.status).toBe(200);
    const logo = seen[0].get("logo");
    expect(logo).toBeInstanceOf(File);
    expect((logo as File).name).toBe("logo.png");
    expect((logo as File).type).toBe("image/png");
    expect(await (logo as File).text()).toBe("PNGDATA");
    const spare = seen[0].get("spare") as File;
    expect(spare).toBeInstanceOf(File);
    expect(spare.size).toBe(0);
    const bad = await call("upload", { args: [{ $formData: [["logo", { $file: { name: "x", type: "t", base64: "***not base64***" } }]] }] }, { registry });
    expect(bad.status).toBe(400);
    const shape = await call("upload", { args: [{ $formData: [["logo", { $file: { name: 1 } }]] }] }, { registry });
    expect(shape.status).toBe(400);
  });

  it("decodes a file close to the 4 MB upload limit and still refuses base64 that is not canonical", async () => {
    const seen: number[] = [];
    const registry = { upload: async (form: FormData) => { seen.push((form.get("logo") as File).size); return null; } };
    const bytes = new Uint8Array(3.8 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index * 31) & 0xff;
    const base64 = Buffer.from(bytes).toString("base64");
    const deps = { bodyLimits: { upload: 8 * 1024 * 1024 } };
    const ok = await call("upload", { args: [{ $formData: [["logo", { $file: { name: "big.png", type: "image/png", base64 } }]] }] }, { registry, deps });
    expect(ok.status).toBe(200);
    expect(seen).toEqual([bytes.length]);
    for (const broken of [`${base64.slice(0, 100)}\n${base64.slice(100)}`, base64.slice(0, -1), `${base64.slice(0, 40)}*${base64.slice(41)}`, `${base64}=`]) {
      const refused = await call("upload", { args: [{ $formData: [["logo", { $file: { name: "x", type: "t", base64: broken } }]] }] }, { registry, deps });
      expect(refused.status).toBe(400);
    }
  });

  it("allows a larger body only for actions that were given a larger limit", async () => {
    const registry = { upload: async () => "ok", other: async () => "ok" };
    const big = "x".repeat(2 * 1024 * 1024);
    const deps = { bodyLimits: { upload: 8 * 1024 * 1024 } };
    expect((await call("upload", { args: [big] }, { registry, deps })).status).toBe(200);
    expect((await call("other", { args: [big] }, { registry, deps })).status).toBe(413);
  });

  it.each([
    ["a GET", "act", { method: "GET" }, 405],
    ["an unknown action name", "nope", {}, 404],
    ["a missing session", "act", { cookie: null }, 401],
    ["a forged session", "act", { cookie: "admin_session=abc.def" }, 401],
    ["a cross-origin request", "act", { origin: "https://evil.test" }, 403],
    ["a request without Origin", "act", { origin: null }, 403],
    ["a non-JSON body", "act", { headers: { "content-type": "text/plain" } }, 415],
  ] as const)("refuses %s without running anything", async (_label, name, over, status) => {
    const action = vi.fn(async () => "ran");
    const response = await call(name, { args: [] }, { ...over, registry: { act: action } });
    expect(response.status).toBe(status);
    expect(action).not.toHaveBeenCalled();
  });

  it("rejects a session whose password version is stale and clears the cookie", async () => {
    const action = vi.fn(async () => "ran");
    const response = await call("act", { args: [] }, { cookie: await sessionCookie(2), registry: { act: action } });
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toMatch(/^admin_session=; Max-Age=0/);
    expect(action).not.toHaveBeenCalled();
  });

  it("caches the password version briefly so most calls do not wait for the database", async () => {
    const credentialVersion = vi.fn(async () => 3);
    let clock = NOW;
    const registry = { act: async () => "ok" };
    const deps = { credentialVersion, now: () => clock, registry, secret: SECRET };
    const request = async () => handleAdminRpc(new Request(`${ORIGIN}/api/admin/rpc/act`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN, cookie: await sessionCookie(3, NOW) },
      body: JSON.stringify({ args: [] }),
    }), "act", deps);
    await request();
    await request();
    expect(credentialVersion).toHaveBeenCalledTimes(1);
    clock += 20_000;
    await request();
    expect(credentialVersion).toHaveBeenCalledTimes(2);
  });

  it("turns redirect() into a redirect answer and notFound() into a 404, with Next's own error shape", async () => {
    const registry = {
      go: async () => { redirect("/admin/brands?created=x"); },
      missing: async () => { notFound(); },
      guarded: async () => {
        try { redirect("/admin/x"); } catch (error) {
          if ((error as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) throw error;
          return "swallowed";
        }
        return "unreachable";
      },
    };
    expect(await (await call("go", { args: [] }, { registry })).json()).toEqual({ ok: true, redirect: "/admin/brands?created=x" });
    const missing = await call("missing", { args: [] }, { registry });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ ok: false, notFound: true });
    expect(await (await call("guarded", { args: [] }, { registry })).json()).toEqual({ ok: true, redirect: "/admin/x" });
  });

  it("gives actions a request context: cookies() reads the request and set/delete become Set-Cookie", async () => {
    const registry = {
      who: async () => {
        const jar = await cookies();
        const seen = jar.get("admin_session")?.value ? "has-session" : "none";
        jar.set("flash", "hi", { path: "/", httpOnly: true, maxAge: 60, sameSite: "lax" });
        jar.delete("admin_session");
        const requestHeaders = await headers();
        return { seen, origin: requestHeaders.get("origin") };
      },
    };
    const response = await call("who", { args: [] }, { registry });
    expect(await response.json()).toEqual({ ok: true, value: { seen: "has-session", origin: ORIGIN } });
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.some((value) => value.startsWith("flash=hi") && value.includes("HttpOnly") && value.includes("Max-Age=60"))).toBe(true);
    expect(setCookies.some((value) => value.startsWith("admin_session=;") && value.includes("Max-Age=0"))).toBe(true);
  });

  it("hides internal error text and secrets from the browser while keeping a fixed code", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((message: unknown) => { logged.push(String(message)); });
    const registry = { boom: async () => { throw new Error(`database password ${SECRET}`); } };
    const response = await call("boom", { args: [] }, { registry });
    spy.mockRestore();
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      error: { code: "action_failed", message: "Не удалось выполнить действие. Попробуйте ещё раз." },
    });
    expect(logged.join("")).not.toContain(SECRET);
  });

  it("lets only the listed public action (login) run without a session, still same-origin and JSON only", async () => {
    const login = vi.fn(async () => "welcome");
    const other = vi.fn(async () => "secret");
    const registry = { login, other };
    const deps = { publicActions: ["login"] };
    const response = await call("login", { args: [] }, { cookie: null, registry, deps });
    expect(response.status).toBe(200);
    expect(login).toHaveBeenCalledTimes(1);
    expect((await call("other", { args: [] }, { cookie: null, registry, deps })).status).toBe(401);
    expect(other).not.toHaveBeenCalled();
    expect((await call("login", { args: [] }, { cookie: null, registry, deps, origin: "https://evil.test" })).status).toBe(403);
  });

  it("tells the browser why the session ended: password changed, or the check could not be made", async () => {
    const action = vi.fn(async () => "ran");
    const expired = await call("act", { args: [] }, { cookie: await sessionCookie(2), registry: { act: action } });
    expect((await expired.json()).error).toMatchObject({ code: "unauthorized", reason: "expired" });
    const unavailable = await call("act", { args: [] }, {
      registry: { act: action },
      deps: { credentialVersion: async () => { throw new Error("db down"); } },
    });
    expect(unavailable.status).toBe(401);
    expect((await unavailable.json()).error).toMatchObject({ code: "unauthorized", reason: "unavailable" });
    expect(action).not.toHaveBeenCalled();
    const missing = await call("act", { args: [] }, { cookie: null, registry: { act: action } });
    expect((await missing.json()).error.reason).toBeUndefined();
  });

  it("renews a session that is close to expiry and keeps its original issue time", async () => {
    const codec = createSessionCodec(SECRET, () => NOW);
    const original = await codec.create({ credentialVersion: 3 });
    const later = NOW + 7 * 24 * 3600 * 1000 - 30 * 60 * 1000;
    const response = await call("echo", { args: [] }, { cookie: `admin_session=${original}`, deps: { now: () => later } });
    const renewed = response.headers.getSetCookie().find((value) => value.startsWith("admin_session="));
    expect(renewed).toBeDefined();
    expect(renewed).toContain("HttpOnly");
    expect(renewed).toContain("Max-Age=604800");
    expect(renewed).toContain("SameSite=Lax");
    const token = decodeURIComponent((renewed as string).split(";")[0].slice("admin_session=".length));
    const payload = await createSessionCodec(SECRET, () => later).read(token);
    expect(payload).toMatchObject({ iat: NOW, credentialVersion: 3 });
    const fresh = await call("echo", { args: [] });
    expect(fresh.headers.getSetCookie().some((value) => value.startsWith("admin_session="))).toBe(false);
  });

  it("limits the request body", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const response = await call("echo", { args: [big] });
    expect(response.status).toBe(413);
  });
});
