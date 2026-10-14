# Local full-route Cloudflare staging crawl

This checkpoint is diagnostic only. It uses the already-running local Supabase
on `127.0.0.1:54321`, its public anon key, and an isolated Next static-build
process. Nothing is deployed or promoted to `dist/site`.

## Result

- Real local snapshot and route manifest: 90 documents, including 88 HTML
  documents plus robots and sitemap. All 90 returned their expected status and
  content type; zero crawl failures.
- Validated/copied 67 `.next/static` files and 22 referenced Git-tracked
  `public/` files. The whole `public/` tree is not copied.
- HTML/SEO: 88/88 documents passed. Sitemap: 63/63 expected and found. Internal
  links: 3865 checked; report `ok: true`.
- Twelve `/product/<slug>` aliases remain pending runtime redirects, not
  accepted as working redirects.
- A byte scan of staged site files found zero occurrences of the local anon
  key. The strict artifact policy passed without waivers.
- The full regression suite passed: 144 test files, 1123 tests; 1 file and 4
  tests skipped. Lint, typecheck and color checks passed (286 files checked for
  direct colors). Focused RED-to-GREEN tests covered the local-only snapshot,
  server-only source override, preflight, and homepage canonical.
- Most recent success: ignored
  `dist/staging/20260925T052923Z-d8f88b11/{site,meta}`. This staging artifact
  deliberately carries unusable diagnostic browser Supabase bindings and is
  **not** admin-ready or deployable.

## Changes and evidence

- Added a read-only, local-only PostgREST snapshot source. It validates the
  local URL and anon/publishable key before fetching, uses GET only, pages all
  tables with stable order, maps the same public relation data as the legacy
  sitemap, and validates the result as a `CatalogSnapshot`.
- Added a staging-only full-crawl CLI that invokes the existing producer with
  the real Next child, `.next/static`, referenced tracked public files, and
  explicit `sitemapPaths`. It prints sanitized outcome/counts and stops its own
  child. It neither starts/stops Docker nor writes production services.
- A new server-only override allows the static build to read local Supabase
  while public `NEXT_PUBLIC_*` bindings in the diagnostic artifact name an
  unusable `.invalid` origin. It is accepted only with `AYPROM_STATIC_BUILD=1`
  and a loopback URL plus public key; ordinary Next/Vercel calls retain their
  previous path. Preflight validates the same separate source. This split is
  necessary because Next inlines `NEXT_PUBLIC_*` values in browser files.
- The first real full crawl found 89 forbidden-content issues from the local
  URL embedded in HTML. After the source/public split and a rebuild with the
  canonical site URL, artifact policy passed and the SEO gate found one real
  mismatch: the route manifest expected a trailing `/` on the home canonical,
  while Next emits the slashless origin. A RED test preceded the one-line fix.
  The next full crawl passed all gates without weakening them.

The successful build used `AYPROM_STATIC_BUILD=1`,
`NEXT_PUBLIC_SITE_URL=https://www.ayprom-gidravlika.kg`, public R2 media origin,
the diagnostic `.invalid` browser Supabase origin/key, and a local-only
`AYPROM_STATIC_BUILD_SUPABASE_*` source from the running Docker stack. It
completed all 36 static-generation tasks. The CLI can be repeated with
`node scripts/cloudflare/local-static-producer.mjs` after supplying the local
source URL/key as `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` **to the CLI process only**; the CLI
passes the values to Next as server-only overrides, never as browser bindings.

## Still open

The 12 product-alias redirects need real Worker routing checks. This local
snapshot has 12 products and no product/vehicle-type links, so it cannot prove
nonempty vehicle results or page-two behavior. The full artifact has not yet
been tested in a browser through workerd, the admin/auth migration is not
started, no real production browser key was included, and no remote staging,
DNS, production Supabase, R2 write, push, or deployment was performed.
