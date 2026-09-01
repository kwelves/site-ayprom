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
  // Не раскрывать технологический стек в каждом HTTP-ответе. Next.js по
  // умолчанию добавляет `X-Powered-By: Next.js`; официальный способ убрать
  // его — этот флаг. Поведение страниц и маршрутов от него не меняется.
  poweredByHeader: false,
  // Admin pages are dynamic, so Next.js 16 otherwise discards their client
  // route payload immediately (dynamic stale time defaults to zero). A short
  // Router Cache window makes back/forward navigation and recently visited
  // tabs instant; Server Actions already call revalidatePath after writes.
  experimental: {
    // В приложении два независимых root layout: публичный сайт и админка.
    // Обычный сегментный not-found не может гарантировать единый документ для
    // URL, которые вообще не совпали ни с одним route. Next 16 обрабатывает
    // такой случай на уровне роутера через app/global-not-found.tsx.
    globalNotFound: true,
    staleTimes: {
      dynamic: 30,
    },
    serverActions: {
      // Vercel Functions ограничивает request body 4.5 МБ независимо от
      // настройки Next.js. Клиент держит файл не больше 3.5 МБ, а оставшиеся
      // 0.5 МБ здесь зарезервированы под multipart и служебные поля Action.
      // Большие create-upload идут напрямую в приватный Supabase staging.
      bodySizeLimit: "4mb",
    },
  },
  // sharp — нативный модуль (.node/.so). Turbopack пытается его забандлить и
  // теряет платформенный бинарник (linux-x64) при трассировке для serverless-
  // функций Vercel, из-за чего /admin/* падал с ERR_DLOPEN_FAILED. Эта опция
  // держит sharp вне бандла — он грузится через require() из node_modules,
  // и Vercel корректно включает нужный бинарник по output file tracing.
  serverExternalPackages: ["sharp"],
  // Turbopack теряет нативный бинарник libvips (@img/sharp-*) при трассировке
  // файлов для serverless-функций Vercel — сама либа помечена внешней, но её
  // .so/.node не докладываются в бандл, из-за чего в проде падает ERR_DLOPEN_FAILED.
  // Явно включаем всё дерево sharp/@img, чтобы бинарник точно попал в функцию.
  outputFileTracingIncludes: {
    "/*": ["node_modules/sharp/**/*", "node_modules/@img/**/*"],
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  images: {
    // Product-card thumbnails deliberately use 60 while full galleries use
    // the default 75. Next 16 requires every optimizer quality explicitly.
    qualities: [60, 75],
    // Next 16 отказывается оптимизировать картинки с адресов, ведущих в
    // локальную сеть: это защита от подлога запросов к внутренним ресурсам.
    // Локальный стек Supabase всегда живёт на 127.0.0.1, поэтому без этого
    // послабления в среде разработки и тестов не открывается ни одно фото
    // товара (HTTP 400, «resolved to private ip»).
    //
    // Включается ТОЛЬКО когда локально само хранилище. В production hostname —
    // домен Supabase, условие ложно, и защита остаётся в силе; послабление
    // физически не может попасть в боевую сборку.
    dangerouslyAllowLocalIP: ["localhost", "127.0.0.1", "::1", "[::1]"].includes(supabaseUrl.hostname),
    remotePatterns: [
      {
        // Протокол берётся из самого адреса Supabase, а не задан жёстко:
        // production работает по https, а локальный стек — по http, и на
        // захардкоженном https оптимизатор отвергал любую картинку каталога в
        // тестовой среде (HTTP 400).
        protocol: supabaseUrl.protocol.replace(":", "") as "http" | "https",
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port || undefined,
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
