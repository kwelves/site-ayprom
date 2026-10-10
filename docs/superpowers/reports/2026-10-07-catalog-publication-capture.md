# Catalog publication capture: local Task 2 evidence

Date: 2026-10-07. Branch: `codex/cloudflare-integration`. Scope: local isolated SQL and Node builder only; no production database, Cloudflare deployment, DNS, Vercel change, or push.

## Result

`public.capture_catalog_publication(expected_revision, release_id, capability_hash)` is callable only by `service_role`. Its private body captures categories, subcategories, brands, category-brand links, vehicle types, published product details and relations, images and variants, characteristics, and vehicle hotspots. It writes search rows from the same locked source revision, computes a canonical content SHA-256, and seals the candidate in one PostgreSQL transaction. The public active pointer is unchanged. The Node builder port checks inputs and the exact receipt shape, uses a private key in request headers, bounds response size and time, and does not retry an uncertain write. Its CLI is deliberately restricted to the disposable loopback database until publication gates exist.

The content hash excludes release identity, capability hash, and capture time. It includes product `updated_at` because sitemap last-modified behavior depends on it. Both the declarative schema and reviewed migration contain explicit private and public function grants. The legacy schema differ omitted grants, so they were added deliberately after generation.

## TDD and verification

- SQL RED: `node scripts/cloudflare/local-catalog-publication-contract.mjs` failed at missing `capture_catalog_publication`. The RED test was checkpointed as `46c1e5e`.
- Node RED: `npx vitest run tests/cloudflare-catalog-publication-capture.test.ts --maxWorkers=2` failed on the missing module. The RED test was checkpointed as `640d437`.
- SQL GREEN: `node scripts/cloudflare/local-catalog-publication-contract.mjs --all` passed 19 SQL files and 432 assertions on a fresh local Supabase stack, 17 legacy publication HTTP probes, 14 capture HTTP probes, two observed PostgreSQL races, and a real builder CLI call. It also proved empty-catalog capture and ran the error-level security advisor with no findings. The harness stopped its own stack; it did not stop the shared stack.
- Node GREEN: focused Vitest passed 41 tests, covering valid and malformed receipts, invalid bindings, public versus private keys, timeouts/oversize/error statuses, fixed errors, and CLI remote-origin refusal.
- `npm run check`: exit 0; lint, typecheck, color checks, and 1830 passing Vitest tests (4 skipped). The existing jsdom navigation warning is not browser evidence.

The first attempt at `--all` exposed old SQL suites that assumed search read editable source rows. Those suites now capture a real release before asserting existing pagination, filters, image variants, and role behavior. The RLS test additionally proves that flipping a source product's `published` flag alone does not publish it; a new release and active-pointer change are required. The unrelated media-job fixture was made independent of the local seed by counting only its own image.

## Remaining gates

This is not a deployable site. Next public queries and the legacy origin still need to read active/pinned release documents; Worker search still needs a pinned capability. Existing source-table public reads remain until both adapters pass. The pinned build needs a sealed local export with no private key or capability in its environment, HTML, logs, or package. Later gates include build/browser parity, Cloudflare Free runtime limits, inactive remote staging, rollback, admin write hookup, and DNS cutover. No remote database migration was applied.
