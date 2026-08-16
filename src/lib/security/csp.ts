type ContentSecurityPolicyOptions = {
  isDevelopment: boolean;
  supabaseOrigin: string;
};

/**
 * Builds the site's static CSP. Keeping this policy free of request-specific
 * nonces preserves Next's static rendering and CDN cacheability. SRI verifies
 * emitted external framework scripts in production.
 *
 * Next's App Router still emits executable inline Flight payload scripts. A
 * nonce would require dynamic rendering, so the narrowly scoped script
 * exception remains until Next can emit those payloads without inline script.
 */
export function buildContentSecurityPolicy({
  isDevelopment,
  supabaseOrigin,
}: ContentSecurityPolicyOptions): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self'",
    // React uses style attributes for measured and animated geometry. Keep
    // this narrowly scoped exception until those values can move to CSS.
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabaseOrigin}`,
    `media-src 'self' ${supabaseOrigin}`,
    // https://*.sentry.io covers regional ingest without baking an
    // organization-specific Sentry DSN into the policy.
    `connect-src 'self' ${supabaseOrigin} https://*.sentry.io`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self'",
  ].join("; ");
}
