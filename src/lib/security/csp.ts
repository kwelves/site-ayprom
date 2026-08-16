type ContentSecurityPolicyOptions = {
  isDevelopment: boolean;
  supabaseOrigin: string;
};

/**
 * Builds the site's static CSP. Keeping this policy free of request-specific
 * nonces preserves Next's static rendering and CDN cacheability.
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
    // React and several framework integrations insert runtime style rules.
    // `style-src-attr` is not sufficient for those `<style>` elements, so
    // preserve this compatibility exception while keeping scripts strict.
    "style-src 'self' 'unsafe-inline'",
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
