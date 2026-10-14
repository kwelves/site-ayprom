# AYPROM Crawl-and-Freeze Static Artifact Design

## Purpose

Build a complete, reproducible static public-site artifact for Cloudflare
Static Assets without converting the application to Next.js static export and
without making the full Next.js runtime the Cloudflare production foundation.

The existing Next/Vercel application remains the legacy adapter and rollback
origin. A separate Node.js builder renders public pages through a loopback
`next start` process, freezes the responses, validates the result, and produces
an immutable artifact for the already-proven thin Worker plus Static Assets
architecture.

## Fixed boundaries

- Cloudflare Static Assets serves public HTML, CSS, JavaScript, fonts, and
  allowlisted local images.
- The thin Worker remains Worker-first only for `/api/*` in this phase.
- Supabase Postgres remains the catalog source of truth.
- Public catalog reads use the publishable key and existing RLS. The builder
  never needs a service-role key for public pages or route discovery.
- R2 continues to serve public media.
- Sharp stays in the external Node build/media processor and never enters the
  Worker request path.
- Vercel remains deployed as rollback-origin.
- No auth, protected admin routes, DNS, deploy, production mutation, R2
  mutation, or Vercel mutation belongs to this phase.
- `output: "export"` and a full vinext runtime are not production foundations.

## Source-data modes

The builder supports three explicitly separated modes.

### Fixture mode

Unit and integration tests provide a checked-in synthetic catalog snapshot.
No Supabase process or network access is required.

### Local snapshot mode

Production-like local builds use a frozen dataset restored into an isolated
loopback Supabase instance. The builder accepts only `http://localhost:54321`
or `http://127.0.0.1:54321`, verifies that the public publishable key is not a
service-role or secret key, and treats the database as immutable for the build.

The current ordinary development seed is not sufficient evidence of production
route completeness. Importing a production-derived read-only snapshot is a
separate, explicitly authorized operation and must not copy secrets or private
admin credentials into the artifact.

### Revisioned live mode

This mode is disabled until the publication-revision phase exists. When later
enabled, the runner records a content revision before reading, builds from the
corresponding stable revision, reads the revision again, and rejects the
artifact if it changed. A direct unrevisioned crawl of live production
Supabase is never accepted as a releasable build.

## Build preflight

The producer is a Node.js CLI under `scripts/cloudflare/`. Before starting
Next.js it validates all required inputs and fails without creating or
replacing `dist/site`.

Required static-build settings are:

- `AYPROM_STATIC_BUILD=1`;
- `NEXT_PUBLIC_SITE_URL=https://www.ayprom-gidravlika.kg` for a releasable
  artifact;
- an allowed local-snapshot Supabase URL and a publishable key;
- `NEXT_PUBLIC_MEDIA_BASE_URL` with the expected HTTPS R2 media origin;
- `NEXT_PUBLIC_HERO_MEDIA_SOURCE=r2`;
- a resolvable Git SHA and no tracked working-tree changes for a releasable
  artifact. The protected untracked `.codex/`, `debug.log`, and
  `docs/CLOUDFLARE_FREE_HOSTING_MIGRATION_PLAN.md` paths do not invalidate a
  build and are never copied.

The preflight rejects:

- missing or malformed required values;
- localhost as the public site URL;
- non-loopback Supabase in local snapshot mode;
- service-role, `sb_secret`, or other secret-key formats in public-key fields;
- an output path outside the repository's `dist/` directory. The first
  implementation slice adds `/dist/` to `.gitignore` before the producer may
  write there;
- an occupied fixed port. The builder normally chooses an ephemeral loopback
  port instead.

The CLI never prints environment-variable values or response bodies that may
contain credentials.

## Framework-neutral route manifest

Route discovery is data-driven. Sitemap crawling and link crawling validate
the route manifest; they do not define it.

A pure module receives a typed catalog snapshot containing:

- categories and their routing type;
- subcategories and parent categories;
- brands;
- vehicle types;
- category-to-brand relations;
- published products, their category, optional subcategory, compatible brands,
  images, and `updatedAt`;
- the product-to-vehicle-type relations required by listing pages.

It returns a deterministic manifest with these entry classes:

- `static`: a public HTML route that must return 200;
- `query`: a static page-one shell enhanced by the catalog API for `q` and
  `page`;
- `redirect`: a legacy alias and its canonical destination;
- `invalid`: published data for which no valid canonical route can be built.

Every entry includes its path, output file, route family, expected canonical,
expected JSON-LD types, expected indexability, and the snapshot identifiers
used to derive it. Entries are sorted by normalized pathname so identical input
always produces byte-identical JSON.

The route families include:

- `/`, `/about`, `/contacts`, and `/catalog`;
- every category, subcategory, brand, and vehicle-type page;
- category-first brand pages;
- brand-first category and brand-first subcategory navigation pages;
- every product canonical generated by the shared product-routing rules;
- `/product/<slug>` aliases as redirect entries;
- `robots.txt`, `sitemap.xml`, and the global 404 document.

The pure canonical-route logic is shared with the legacy sitemap adapter. This
prevents the static builder and Vercel sitemap from silently deriving different
product URLs. Navigation-only pages may be present in the route manifest while
remaining intentionally absent from sitemap.xml.

Published products that resolve only to `/catalog` are listed as `invalid` and
fail the completeness gate. They are never silently dropped from build reports.

## Rendering pipeline

For an approved snapshot the CLI performs these steps:

1. Create an isolated staging directory under ignored `dist/`.
2. Run `next build` with the validated static-build environment.
3. Start `next start` on an ephemeral loopback port with the same environment.
4. Wait for readiness and build the framework-neutral route manifest from the
   frozen snapshot.
5. Fetch every `static` and `query` route with bounded concurrency and an
   explicit timeout.
6. Fetch `robots.txt`, `sitemap.xml`, and an intentionally unknown URL for the
   real 404 response.
7. Record redirects without following them into duplicate HTML files.
8. Copy the whole build's `.next/static/` directory.
9. Copy only tracked public files referenced by emitted HTML, CSS, or metadata.
   Untracked files and broad `public/` directory copies are forbidden.
10. Generate `_headers`, `_redirects` only for bounded fixed rules, and the
    public catalog-routing data needed by the search client. Product-alias
    redirect entries remain in metadata for the later thin-Worker redirect
    slice; they are not expanded into Cloudflare `_redirects` or duplicate
    HTML files in this phase.
11. Write reports and manifests into staging metadata.
12. Run every artifact, SEO, link, browser, and workerd gate.
13. Stop the Next child process and verify it exited.
14. Promote the staging artifact only after every gate passes. If promotion on
    Windows fails, restore the previous local artifact and leave the failed
    staging directory identified in the error report.

Signals interrupt the child process and run the same bounded cleanup. A total
timeout prevents an abandoned build from keeping `next start` alive.

## Static-build compatibility mode

`AYPROM_STATIC_BUILD=1` affects only the external artifact build. Normal local,
Vercel, and test builds retain their current behavior.

### Images

Next Image Optimization is disabled only in static-build mode. Public HTML must
contain direct local or R2 image URLs and no `/_next/image` references. The
existing Vercel build continues using its current optimizer settings.

### Search and pagination

Each query-family route freezes its default page-one HTML. After hydration, a
small client adapter reads `q` and `page`, calls the existing
`GET /api/catalog/search` contract, and replaces the product-grid state.

The adapter preserves back/forward navigation, loading, empty, invalid-page,
and sanitized-error states. It uses shared product-route metadata to generate
the same canonical product links as the server. Base pages remain useful
without JavaScript, while query-specific results require JavaScript.

The mixed-category direct-product listing is not declared complete until its
pagination has an equivalent public API contract; the builder reports that
route family as blocked until then.

### Next navigation and RSC

Static Assets cannot provide request-header-dependent RSC responses without
running a Worker for public navigation. Asset-first delivery therefore remains
the invariant.

A browser gate records every request while navigating between representative
public pages. The accepted behavior is either correct document navigation with
no RSC request, or a verified automatic hard-navigation fallback without
console errors. If the current Next links request unusable RSC payloads,
static-build mode renders public navigation through a shared full-document link
adapter and disables viewport prefetch. The Worker is not expanded to all
public pages as a workaround.

## Artifact layout

Only `dist/site/` is deployable:

```text
dist/
  site/
    index.html
    about.html
    contacts.html
    catalog.html
    catalog/**/*.html
    404.html
    robots.txt
    sitemap.xml
    _headers
    _redirects
    _next/static/**
    _data/catalog-routing.<hash>.json
    <referenced tracked public assets>
  meta/
    build-manifest.json
    route-manifest.json
    asset-manifest.json
    link-report.json
    verification-report.json
```

Cloudflare uses `html_handling: "drop-trailing-slash"`. Root maps to
`index.html`; non-root documents use `<route>.html`. This permits a page such
as `catalog/category/pto.html` to coexist with deeper files under
`catalog/category/pto/`.

`dist/meta/` never sits under `assets.directory` and is never uploaded.

The existing `wrangler.static-assets.jsonc` continues to point at the checked-in
fixture while the producer is under development. Switching its
`assets.directory` to `dist/site` is a separate local checkpoint performed
only after the complete artifact passes every gate; it is not a deploy or a
production cutover.

## Build manifest

`build-manifest.json` has a versioned schema and includes:

- schema version and build ID;
- Git SHA and Next/Wrangler versions;
- build start and finish timestamps;
- source-data mode and non-secret snapshot identity;
- canonical public site and media origins;
- route counts by class and family;
- total asset count, total bytes, and largest file;
- route, asset, sitemap, and catalog-routing hashes;
- verification result summary;
- revision start/end fields when revisioned live mode is eventually enabled.

Timestamps are excluded from content identity. The build ID is derived from the
Git SHA, snapshot identity, and deterministic manifest hashes.

## Validation gates

The artifact is rejected when any gate fails.

### Route and data completeness

- Every manifest `static` or `query` route has exactly one output file.
- Every sitemap URL resolves to exactly one manifest route.
- Every internal public link resolves to an emitted route, a bounded fixed
  redirect, a declared product alias reserved for the later thin-Worker
  redirect slice, or a fragment on the same document.
- Route counts reconcile with the frozen catalog snapshot.
- No `invalid` published product remains.
- Redirect loops and redirect chains longer than one hop are forbidden.
- Product aliases are reported as pending rather than falsely passing runtime
  redirect parity until the thin-Worker redirect slice is implemented.

### HTML and SEO

- Every public page has one expected canonical URL, a non-empty title, and one
  logical H1.
- JSON-LD types match the route-family contract.
- Public pages are indexable; admin and 404 documents are not.
- The 404 document is served with HTTP 404 by the workerd gate.
- No canonical, Open Graph, JSON-LD, script, or asset URL contains localhost,
  a Vercel preview domain, or a Supabase hero-media fallback.

### Asset and secret policy

- Warning threshold: 15,000 files; hard Cloudflare limit gate: 20,000 files.
- No file exceeds 25 MiB.
- `.env*`, source maps, `_worker.js`, source trees, dependency trees, Markdown,
  RSC files, and local videos are forbidden.
- Text files are scanned for service-role/secret key formats, admin secrets,
  R2 secrets, localhost origins, and `/_next/image`.
- Duplicate normalized paths and case-insensitive collisions fail on Windows.

### Runtime parity

- Static HTML, CSS, JavaScript, 404, robots, and sitemap are served by real
  local Wrangler/workerd.
- `/api/health` and `/api/catalog/search` remain Worker responses even when a
  conflicting asset exists.
- Worker bundle allowlist and measured size remain enforced.
- Static security headers and Worker security headers are checked by response
  class.
- Playwright covers hydration, representative navigation, search, pagination,
  direct refresh with query parameters, back/forward behavior, broken assets,
  console errors, and unexpected RSC requests.

## Failure behavior

The CLI returns a non-zero exit code with a stable error code and a concise
non-secret summary. Failure classes are:

- `preflight_failed`;
- `snapshot_invalid`;
- `route_manifest_incomplete`;
- `next_build_failed`;
- `next_start_failed`;
- `crawl_failed`;
- `artifact_policy_failed`;
- `parity_failed`;
- `promotion_failed`;
- `cleanup_failed`.

The first primary failure is preserved even if cleanup also fails. Cleanup
errors are reported as secondary diagnostics. A failed build never replaces a
previous successful `dist/site`.

## Testing strategy

Implementation follows TDD in these layers:

1. Pure unit tests for environment validation, route derivation, deterministic
   sorting, route-to-file mapping, collision detection, and manifests.
2. Artifact-policy tests for forbidden paths, forbidden content, sizes, links,
   canonical/SEO rules, and incomplete products.
3. Process-runner tests for readiness, timeout, interruption, child cleanup,
   sanitized logs, and failed promotion recovery.
4. Integration tests against fixture HTTP responses.
5. A real local frozen-Supabase build producing the complete artifact.
6. The existing three-run Wrangler/workerd asset gate against that artifact.
7. Playwright browser parity against workerd.
8. Existing `npm run check` and `npm run build` to protect the legacy adapter.

Each medium implementation slice updates Graphify and receives a local Git
checkpoint. Nothing is pushed or deployed without a separate user command.

## Implementation slices

1. Pure contracts: build preflight, snapshot types, route manifest, artifact
   policy, and RED/GREEN unit tests.
2. Framework-neutral route derivation shared by the legacy sitemap and builder,
   with adapter-parity tests.
3. Child-process lifecycle and crawl producer writing only to staging.
4. Conditional static-build image and navigation compatibility.
5. Client catalog search/pagination adapter and mixed-category API completion.
6. Full artifact assembly, manifests, reports, and recoverable promotion.
7. Real local snapshot, workerd, and browser verification.

After slice 7 passes, a separate local checkpoint may point the Static Assets
test configuration from its fixture to `dist/site`. Product-alias redirects
remain a following thin-Worker slice and are not smuggled into that checkpoint.

Revisioned production builds, publication queues, auth/admin migration, remote
staging, deployment, DNS cutover, and Vercel decommission remain later phases.

## Acceptance criteria

The local phase is complete only when:

- a frozen local snapshot produces all expected public routes;
- manifest, sitemap, snapshot counts, and internal links reconcile;
- no forbidden secret, URL, optimizer route, or file enters `dist/site`;
- search and pagination work through the shared Worker API contract;
- every product alias is present in the manifest and explicitly reported as
  pending until the later thin-Worker redirect slice provides runtime parity;
- representative navigation hydrates without RSC or console failures;
- Wrangler/workerd proves asset-first routing three consecutive times;
- the Worker bundle stays within its existing allowlist and measured-size gate;
- `npm run check`, `npm run build`, Graphify, and the local Git checkpoint pass;
- no push, deploy, DNS, production Supabase, production R2, or Vercel mutation
  has occurred.
