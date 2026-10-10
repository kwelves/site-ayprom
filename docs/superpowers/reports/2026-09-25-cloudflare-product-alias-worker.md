# Local product-alias Worker gate — 2026-09-25

This is a local-only integration checkpoint, not a Cloudflare deployment.

## Result

- The frozen route manifest supplies the `/product/<slug>` aliases. The producer rejects an alias whose destination is not a served page in that same manifest, then writes a deterministic Worker entry under `staging/meta/`, never under `staging/site/`.
- The framework-neutral handler returns HTTP 308 for known aliases on GET/HEAD, does not preserve query parameters, rejects unsafe/external targets, and leaves unknown aliases to the base Worker/static-assets routing.
- The local full-site probe built the generated entry with `wrangler deploy --dry-run`, then exercised it through local `wrangler dev`: 12/12 aliases returned 308 and their destinations returned 200; an unknown alias returned 404.
- Measured dry-run JavaScript bundle: **14,559 bytes raw, 3,727 bytes gzip**. The 30,419-byte source map was written only to ignored `staging/meta/worker-dry-run/`, not the served `staging/site/`.

## TDD and verification

- RED: the alias module and generated entry did not exist, so the new contract tests failed before implementation. GREEN: focused alias and producer tests passed (24/24).
- `npm run check` passed: lint, typecheck, color policy, and 1,127 tests passed (4 skipped).
- The full snapshot producer completed 90 routes with no crawl, HTML, sitemap, or internal-link failures. The local browser probe passed eight checks, with no page errors, uncaptured prefetches, or unexpected local HTTP failures.
- A plain `npm run build` without local environment variables failed immediately in `next.config.ts` (`Invalid URL`, input `undefined`). This is an environment prerequisite, not a passing build claim; the earlier full-route checkpoint built successfully with explicit diagnostic/local bindings, before this Worker-only change.
- No product alias has been configured or tested in a Cloudflare account. `dist/site` was not promoted or deployed.

## Remaining gates

- The generated entry is still a staging artifact importing source files from this checkout. A production package/configuration and deployment pipeline must explicitly use it before any rollout.
- Headers, auth, production bindings, and remote smoke tests remain separate work. Next/Vercel remains the rollback origin.
