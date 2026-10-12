import { describe, expect, it } from "vitest";
import { adminSecurityHeaders, applyAdminSecurityHeaders } from "@/cloudflare/admin-worker/security-headers";

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://acyoyvetcyqmwppfenau.supabase.co",
  NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
};

describe("admin Worker security headers", () => {
  it("sends the same protections the Vercel site sends, plus noindex for the admin", () => {
    const headers = adminSecurityHeaders(env);
    expect(headers["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=(), browsing-topics=()");
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
  });

  it("builds the policy from the configured database and media addresses, and allows nothing else", () => {
    const csp = adminSecurityHeaders(env)["Content-Security-Policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' https://acyoyvetcyqmwppfenau.supabase.co");
    expect(csp).toContain("img-src 'self' data: blob: https://media.ayprom-gidravlika.kg");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("still sends a strict policy when the addresses are missing or malformed", () => {
    for (const broken of [{}, { NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_MEDIA_BASE_URL: "javascript:alert(1)" }]) {
      const csp = adminSecurityHeaders(broken)["Content-Security-Policy"];
      expect(csp).toContain("default-src 'self'");
      expect(csp).not.toMatch(/javascript:|not a url/);
    }
  });

  it("lets a local test database over plain http be used, but never a plain-http address elsewhere", () => {
    const local = adminSecurityHeaders({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321", NEXT_PUBLIC_MEDIA_BASE_URL: "http://127.0.0.1:54321" })["Content-Security-Policy"];
    expect(local).toContain("connect-src 'self' http://127.0.0.1:54321");
    expect(local).toContain("img-src 'self' data: blob: http://127.0.0.1:54321");
    const remote = adminSecurityHeaders({ NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co", NEXT_PUBLIC_MEDIA_BASE_URL: "http://media.example.test" })["Content-Security-Policy"];
    expect(remote).not.toContain("http://example.supabase.co");
    expect(remote).not.toContain("http://media.example.test");
  });

  it("adds the headers to a response without touching its body, status or cookies", async () => {
    const original = new Response("hello", { status: 201, headers: { "Set-Cookie": "admin_session=abc; HttpOnly", "Content-Type": "text/plain", "X-Frame-Options": "SAMEORIGIN" } });
    const result = applyAdminSecurityHeaders(original, env);
    expect(result.status).toBe(201);
    expect(await result.text()).toBe("hello");
    expect(result.headers.get("Set-Cookie")).toBe("admin_session=abc; HttpOnly");
    expect(result.headers.get("Content-Type")).toBe("text/plain");
    // Our value wins over a weaker one set earlier.
    expect(result.headers.get("X-Frame-Options")).toBe("DENY");
    expect(result.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
  });

  it("keeps redirects and answers whose headers cannot be changed (assets) working", () => {
    const redirect = Response.redirect("https://example.test/admin/products", 302);
    const result = applyAdminSecurityHeaders(redirect, env);
    expect(result.status).toBe(302);
    expect(result.headers.get("Location")).toBe("https://example.test/admin/products");
    expect(result.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
