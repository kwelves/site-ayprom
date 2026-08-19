import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import { buildContentSecurityPolicy } from "@/lib/security/csp";

const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
const contentSecurityPolicy = buildContentSecurityPolicy({
  isDevelopment: process.env.NODE_ENV === "development",
  supabaseOrigin: supabaseUrl.origin,
});

const nextConfig: NextConfig = {
  // sharp — нативный модуль (.node/.so). Turbopack пытается его забандлить и
  // теряет платформенный бинарник (linux-x64) при трассировке для serverless-
  // функций Vercel, из-за чего /admin/* падал с ERR_DLOPEN_FAILED. Эта опция
  // держит sharp вне бандла — он грузится через require() из node_modules,
  // и Vercel корректно включает нужный бинарник по output file tracing.
  serverExternalPackages: ["sharp"],
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
// Plugin-specific Sentry options are deliberately omitted. The wrapper keeps
// runtime reporting active for both the Webpack production build and Turbopack
// development server without changing the current telemetry contract.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
});
