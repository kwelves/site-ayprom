import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

const supabaseOrigin = "https://example.supabase.co";
const mediaOrigin = "https://media.example.com";

function directive(policy: string, name: string): string {
  const value = policy.split("; ").find((part) => part.startsWith(`${name} `));
  if (!value) {
    throw new Error(`Missing ${name} directive`);
  }

  return value;
}

describe("buildContentSecurityPolicy", () => {
  it("keeps the necessary static App Router exception while preserving required service origins", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: false, supabaseOrigin, mediaOrigin });

    // Next 16 still streams executable inline Flight payloads. Removing this
    // would block hydration unless every route became dynamically rendered to
    // receive a nonce, which would sacrifice static CDN caching.
    expect(directive(policy, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
    expect(directive(policy, "connect-src")).toContain(supabaseOrigin);
    expect(directive(policy, "connect-src")).toContain("https://*.sentry.io");
    // Catalog images are fully migrated to R2 (2026-09-12); Supabase Storage
    // is no longer a valid image source and must stay out of img-src.
    expect(directive(policy, "img-src")).not.toContain(supabaseOrigin);
    expect(directive(policy, "img-src")).toContain(mediaOrigin);
    // Hero videos still serve from Supabase until NEXT_PUBLIC_HERO_MEDIA_SOURCE
    // switches to r2, so media-src must keep both origins.
    expect(directive(policy, "media-src")).toContain(supabaseOrigin);
    expect(directive(policy, "media-src")).toContain(mediaOrigin);
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("permits the eval-based Next development overlay without weakening scripts in production", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: true, supabaseOrigin });

    expect(directive(policy, "script-src")).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it("disables embeds and limits workers to same-origin scripts", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: false, supabaseOrigin });

    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
    expect(directive(policy, "worker-src")).toBe("worker-src 'self'");
  });
});
