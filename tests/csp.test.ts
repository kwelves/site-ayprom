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
    // Catalog images and hero videos are fully migrated to R2 (2026-09-12);
    // Supabase Storage is no longer a valid media source and must stay out
    // of img-src/media-src.
    expect(directive(policy, "img-src")).not.toContain(supabaseOrigin);
    expect(directive(policy, "img-src")).toContain(mediaOrigin);
    expect(directive(policy, "media-src")).not.toContain(supabaseOrigin);
    expect(directive(policy, "media-src")).toContain(mediaOrigin);
    expect(directive(policy, "style-src")).toBe("style-src 'self' 'unsafe-inline'");
  });

  it("still allows the media origin in img-src/media-src when it equals supabaseOrigin", () => {
    // CI has no separate R2 origin, so it points NEXT_PUBLIC_MEDIA_BASE_URL at
    // the same local Supabase instance as NEXT_PUBLIC_SUPABASE_URL. That must
    // still open img-src/media-src for it — otherwise every E2E fixture photo
    // is blocked by CSP (regression: previously deduped away as "equal to
    // supabaseOrigin" from back when img-src also carried supabaseOrigin on
    // its own).
    const policy = buildContentSecurityPolicy({
      isDevelopment: false,
      supabaseOrigin,
      mediaOrigin: supabaseOrigin,
    });

    expect(directive(policy, "img-src")).toContain(supabaseOrigin);
    expect(directive(policy, "media-src")).toContain(supabaseOrigin);
  });

  it("permits the eval-based Next development overlay without weakening scripts in production", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: true, supabaseOrigin });

    expect(directive(policy, "script-src")).toBe("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it("opens the Cloudflare Web Analytics script and its report address only when the site asks for it", () => {
    const off = buildContentSecurityPolicy({ isDevelopment: false, supabaseOrigin });
    expect(off).not.toContain("cloudflareinsights.com");

    const on = buildContentSecurityPolicy({ isDevelopment: false, supabaseOrigin, webAnalytics: true });
    expect(directive(on, "script-src")).toBe("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(directive(on, "connect-src")).toContain("https://cloudflareinsights.com");
    // Nothing else is widened.
    expect(directive(on, "img-src")).toBe(directive(off, "img-src"));
    expect(directive(on, "frame-src")).toBe("frame-src 'none'");
  });

  it("disables embeds and limits workers to same-origin scripts", () => {
    const policy = buildContentSecurityPolicy({ isDevelopment: false, supabaseOrigin });

    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
    expect(directive(policy, "worker-src")).toBe("worker-src 'self'");
  });
});
