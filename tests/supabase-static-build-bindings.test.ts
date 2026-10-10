import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveStaticBuildSupabaseBindings } from "@/lib/supabase/static-build-bindings";
import { createClient } from "@/lib/supabase/server";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("static-build Supabase source bindings", () => {
  it("does not affect the ordinary Next/Vercel adapter", () => {
    expect(resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "0",
      AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    })).toBeNull();
  });

  it("uses an explicit local public source only for a static build", () => {
    expect(resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    })).toEqual({ url: "http://127.0.0.1:54321", key: "sb_publishable_local_test" });
  });

  it("accepts a per-build cache nonce only for the diagnostic static source", () => {
    const nonce = "0123456789abcdef0123456789abcdef";
    expect(resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      AYPROM_STATIC_BUILD_CACHE_NONCE: nonce,
    })).toEqual({ url: "http://127.0.0.1:54321", key: "sb_publishable_local_test", cacheNonce: nonce });
    expect(resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "0", AYPROM_STATIC_BUILD_CACHE_NONCE: nonce,
    })).toBeNull();
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
      AYPROM_STATIC_BUILD_CACHE_NONCE: "bad\r\nheader",
    })).toThrow("static_build_cache_nonce_invalid");
  });

  it("rejects partial, remote and service-role overrides", () => {
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1", AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
    })).toThrow("static_build_supabase_bindings_incomplete");
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1", AYPROM_STATIC_BUILD_SUPABASE_URL: "https://example.supabase.co",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local_test",
    })).toThrow("local_probe_invalid_binding");
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1", AYPROM_STATIC_BUILD_SUPABASE_URL: "http://127.0.0.1:54321",
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: "sb_secret_nope",
    })).toThrow("local_probe_invalid_binding");
  });

  it("puts the nonce on static-build reads but not ordinary Next/Vercel reads", async () => {
    const fetcher = vi.fn(async (...request: Parameters<typeof fetch>) => {
      expect(request[0]).toBeDefined();
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_local_test");
    vi.stubEnv("AYPROM_STATIC_BUILD", "1");
    vi.stubEnv("AYPROM_STATIC_BUILD_SUPABASE_URL", "http://127.0.0.1:54321");
    vi.stubEnv("AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_local_test");
    vi.stubEnv("AYPROM_STATIC_BUILD_CACHE_NONCE", "0123456789abcdef0123456789abcdef");
    await (await createClient()).from("products").select("slug");
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("x-ayprom-static-build-cache")).toBe(
      "0123456789abcdef0123456789abcdef",
    );
    vi.stubEnv("AYPROM_STATIC_BUILD", "0");
    await (await createClient()).from("products").select("slug");
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).has("x-ayprom-static-build-cache")).toBe(false);
  });
});
