import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseUrl.origin}`,
  "media-src 'self'",
  // https://*.sentry.io covers every regional ingest host without needing to
  // hardcode the org-specific subdomain baked into the DSN.
  `connect-src 'self' ${supabaseUrl.origin} https://*.sentry.io`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: supabaseUrl.hostname,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  async headers() {
    const securityHeaders = [
      { key: "Content-Security-Policy", value: contentSecurityPolicy },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];

    if (process.env.NODE_ENV === "production") {
      securityHeaders.push({
        key: "Strict-Transport-Security",
        value: "max-age=63072000; includeSubDomains; preload",
      });
    }

    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// authToken (SENTRY_AUTH_TOKEN) is only needed to upload readable source maps
// during `next build` in CI/production — unset locally, error reporting still
// works, stack traces are just minified.
// disableLogger/automaticVercelMonitors are webpack-plugin options with no
// Turbopack equivalent yet — this project builds with Turbopack, so they're
// omitted rather than set to a config path that's silently ignored.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
