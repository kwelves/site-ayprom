# AYPROM route derivation and sitemap parity

## Goal

Derive public static-build routes and sitemap entries from one framework-neutral catalog input, while preserving the current Next/Vercel sitemap adapter. This is slice 2 of `docs/superpowers/specs/2026-09-21-ayprom-crawl-and-freeze-design.md`; it does not render assets or change production routing.

## Global constraints

- Work on the current branch; preserve existing untracked paths and unrelated changes.
- TDD for each behavior: write a failing test, run it, implement minimally, rerun it.
- Keep `getProductHref` as the product canonical rule; do not introduce a competing route formula.
- Use only public catalog data. No service-role use, auth migration, deployment, DNS, or external state changes.
- Preserve the sitemap's existing public URL set and metadata for valid products. Navigation-only brand-first routes are manifest-only.
- An unresolved published product must become an `invalid` manifest entry, never disappear from the build report.

## Task 1: pure route derivation

Files: `src/cloudflare/static-build/derive-routes.ts`, `tests/cloudflare-static-build-derive-routes.test.ts`.

1. RED: Add a hand-checked fixture with flat, subcategory, and brand categories, composite subcategory slugs, brands, vehicles, products, and one unresolved product. Assert the exact route families/classes and product canonical/alias/invalid paths. Product pages are `static`. Run only the new test and confirm the expected failure.
2. GREEN: Add a narrow structural input compatible with `CatalogSnapshot` and the seven current sitemap query results. Derive root and catalog pages; category, subcategory, brand, vehicle, category-first brand, brand-first category/subcategory navigation; product canonical and `/product/<slug>` redirect or invalid; robots, sitemap, and 404. Use `getProductHref` for products and `routePathToOutputFile` for emitted output paths. Return manifest entries plus sitemap entries.
3. RED/GREEN: Add cases for deterministic output, deduplication, composite subcategory identity, invalid product completeness, and an explicit blocker for mixed-category pagination until its public API exists. Create a validated manifest through `createRouteManifest` in tests, checking no path/output collisions.

## Task 2: legacy adapter parity

Files: `src/app/sitemap.ts`, `tests/cloudflare-static-build-derive-routes.test.ts` (and a focused adapter test only if required).

1. RED: Assert the sitemap projection's exact legacy URL/priority/change-frequency/last-modified/image behavior, including relative and absolute images and unresolved-product omission. Assert that each sitemap path has one static/query manifest entry.
2. GREEN: Replace the sitemap's local route loops with a call to the pure derivation function, adapting current query results and mapping pure entries to `MetadataRoute.Sitemap`. Preserve the seven query calls and revalidation policy.
3. Add an adapter parity test using controlled query responses, so a changed Next adapter cannot drift from pure output.

## Verification and checkpoint

Run focused tests after every RED/GREEN, then `npm run check`, `npm run build`, `graphify update .`, inspect `git diff --check` and `git status --short --branch`, and create one local Git checkpoint. Do not push or deploy. Report the exact check counts, HEAD/status, and anything deferred to the rendering/asset slice.

## Review focus

- Every emitted route must correspond to an existing Next page or defined artifact.
- A brand-first navigation route must require a real product/brand relation, not a Cartesian product.
- Composite subcategory keys must include the parent category.
- Invalid published products must remain visible in the manifest while absent from sitemap.
- Sitemap metadata and output order must remain compatible with Vercel's current adapter.
- The three legacy product pages currently calculate `<link rel=canonical>` independently; their rendered metadata parity remains a later crawl gate, not a claim of this unit-test slice.
