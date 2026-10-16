import { buildContentSecurityPolicy } from "../../../lib/security/csp";
import { ProducerError } from "./errors";

export const SPECULATION_RULES_FILE = "speculationrules.json";

const NOT_PRIVATE = { not: { href_matches: ["/admin", "/admin/*", "/api/*", "/product/*"] } };

/** Pages a visitor is about to open are prerendered on hover/press (Chromium); other browsers ignore this.
 * Admin, API and the /product alias redirects are never speculated. All pages are static and side-effect free. */
export function serializeSpeculationRules(): string {
  const where = { and: [{ href_matches: "/*" }, NOT_PRIVATE] };
  return `${JSON.stringify({
    prerender: [{ where, eagerness: "moderate" }],
    prefetch: [{ where, eagerness: "conservative" }],
  })}
`;
}

/** Cloudflare applies this file only to Static Assets, never Worker responses. */
export function serializeStaticHeaders(input: {
  siteOrigin: string;
  mediaOrigin: string;
  browserSupabaseUrl?: string;
  /** The site is built with the Cloudflare Web Analytics script. */
  webAnalytics?: boolean;
}): string {
  const supabaseOrigin = browserOrigin(input.browserSupabaseUrl, input.siteOrigin);
  const csp = buildContentSecurityPolicy({
    isDevelopment: false,
    supabaseOrigin,
    mediaOrigin: input.mediaOrigin,
    webAnalytics: input.webAnalytics === true,
  });
  const lines = [
    "/*",
    `  Content-Security-Policy: ${csp}`,
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    "  Strict-Transport-Security: max-age=63072000; includeSubDomains; preload",
    // Instant navigation: Chromium may prerender/prefetch the same-origin pages named in this file.
    `  Speculation-Rules: "/${SPECULATION_RULES_FILE}"`,
    "",
    // The workers.dev address must stay reachable (the publication worker checks the live site there) but is only
    // technical: search engines must not index it as a copy of the real site. Applies on top of the rule above.
    "https://:worker.:subdomain.workers.dev/*",
    "  X-Robots-Tag: noindex",
    "",
    `/${SPECULATION_RULES_FILE}`,
    "  Content-Type: application/speculationrules+json",
    "  Cache-Control: public, max-age=3600",
  ];
  if (lines.some((line) => line.length > 2_000)) {
    throw new ProducerError("artifact_policy_failed", "static_headers_line_too_long", {
      issues: [{ field: "_headers", rule: "line_too_long" }],
    });
  }
  return `${lines.join("\n")}\n`;
}

function browserOrigin(raw: string | undefined, fallback: string): string {
  if (raw === undefined) return fallback;
  try {
    if (raw.trim() !== raw || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("unsafe_origin");
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
      throw new Error("unsafe_origin");
    }
    return url.origin;
  } catch {
    throw new ProducerError("preflight_failed", "static_header_origin_invalid", {
      issues: [{ field: "NEXT_PUBLIC_SUPABASE_URL", rule: "invalid_origin" }],
    });
  }
}
