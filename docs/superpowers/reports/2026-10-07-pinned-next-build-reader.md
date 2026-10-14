# Pinned Next reader and route inventory handoff

Local Task 3 checkpoint, not a completed build or deployment. No production service, DNS, R2, Vercel, Cloudflare account or shared Supabase stack was changed. The existing diagnostic runner still needs a coordinator to create the export automatically.

## Result

- The private parent can write the complete exported release only into a new `dist/staging/<run>/meta/catalog-publication-export.json`. The path, release ID and SHA-256 file digest form the child handoff; no admin key or release capability is passed. The Next child rechecks path containment, symlinks, digest, release ID, document kinds/count and duplicate keys before reading it.
- `AYPROM_PUBLIC_CATALOG_READ_MODE=pinned` is accepted only during a static build. Public Next queries use the pinned file; `getProducts` preserves filtering, exact count and `ProductPage` paging for frozen pages, without querying editable tables or the active release. It rejects non-empty `q` in the frozen build rather than approximating database search; browser searches remain the Worker API's job.
- The full release is also projected into the existing route-manifest snapshot. Multi-brand HTML routes and the single canonical sitemap entry derive from the same data as pages. `local-static-producer.mjs` selects that projection when given a pinned file; otherwise its existing diagnostic source mode remains.
- Child environment construction passes only file path, digest and release ID. A parent admin key or capability is not inherited.

## TDD and checks

- RED: missing local-file module, unsupported pinned Next mode, missing route projection, and absent child binding. GREEN: targeted file, pinned-query, route and build-config suites — 29 tests.
- `npm run check`: exit 0; lint, typecheck, colors and 208 test files passed (1 skipped), 1874 tests passed (4 skipped).
- Graphify and staged diff check are final checkpoint gates, recorded with the commit.

## Still required

- Connect capture → export → file → `next build` → crawl in one isolated local run and inspect real HTML/SEO. The current build runner does not yet create the file itself.
- The active legacy reader's 999-row limit and release-pointer switch window remain. Worker search still needs release pinning. Existing production grants and deployment remain unchanged.
- A file digest detects corruption after handoff, not an independent recomputation of the database release SHA or an OS-level signature. The known path-swap race after validation is not closed.
