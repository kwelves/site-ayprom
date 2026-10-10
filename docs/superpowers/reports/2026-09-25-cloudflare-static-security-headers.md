# Local static security-header gate — 2026-09-25

This is a local-only Cloudflare Static Assets checkpoint. Nothing was deployed or promoted to `dist/site`.

## Contract

The producer writes one `_headers` file to the successful staging `site/` tree. It reuses the existing Next CSP builder, and matches the Next security-header values for referrer policy, MIME sniffing, framing, permissions, cross-origin opener policy, and HSTS. The browser Supabase origin is read from the explicit static-build environment, or falls back to the site origin in synthetic fixture mode. Unsafe origins and overlong Cloudflare header lines fail before a staging directory is created. The `_headers` file is included in the artifact-policy file count and secret scan; a referenced `public/_headers` cannot replace it.

Cloudflare applies `_headers` only to Static Assets, not to Worker-generated API responses ([Cloudflare documentation](https://developers.cloudflare.com/workers/static-assets/headers/)). API header parity is a separate task. The local smoke config now sets `not_found_handling: "404-page"` so the staged `404.html` is served with HTTP 404 and receives the static headers.

## RED → GREEN

- Producer tests before implementation: 2 failed / 20 passed. The file was missing, and a newline-bearing browser origin was accepted.
- Producer tests after implementation: 22/22 passed.
- Actual workerd probe against an older staging tree without `_headers`: 0/5 response classes passed, exit 1.
- First new staging probe: 4/5 passed; only the platform-generated 404 lacked headers. The cause was the probe config omitting `404-page`, not a missing rule. After the configuration fix and expanded classes, 7/7 passed, exit 0.

## Verification

- `npm run check`: lint, typecheck, color check and 1,128 passing tests (4 skipped), exit 0.
- `npm run build` with explicit diagnostic public bindings and read-only local Supabase source: 36/36 static-generation tasks, exit 0.
- Full producer after that build: 90/90 routes written, no crawl/SEO/sitemap/link failures, 12 product aliases pending in the manifest; child process stopped.
- Final `wrangler deploy --dry-run`, local `wrangler dev` and Chromium probe: 7/7 static header classes (catalog, product, robots, sitemap, 404, CSS, JS); all search/navigation checks green, 12/12 aliases redirected to HTTP 200 destinations, zero page errors, zero uncaptured prefetches, zero unexpected local HTTP errors.

## Remaining boundary

This diagnostic staging uses a deliberately unusable browser Supabase origin and is not a releasable site. Worker API responses require their own header handling. Auth, production bindings, remote staging, release packaging, and cutover are not covered here. Vercel remains the rollback origin.
