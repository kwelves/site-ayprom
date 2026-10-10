# Cloudflare Immutable Catalog Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Public pages, search, and the legacy origin read one published catalog release, never in-progress admin edits.

**Architecture:** Keep editable Supabase tables as the admin source. Capture a complete immutable release inside Supabase; expose only release-scoped, least-privilege read functions. Build-mode Next reads a pinned release, while legacy public traffic reads the active release. Worker search carries a server-only release capability. This plan is additive until the compatibility gate permits revoking old public table reads.

**Tech Stack:** PostgreSQL/pgTAP/PostgREST, Supabase CLI pg-delta, TypeScript, Next.js, Cloudflare Worker/workerd, Vitest.

**Spec:** [Approved publication consistency design](../specs/2026-10-05-cloudflare-publication-consistency-design.md).

## Global Constraints

- TDD per task; inspect relevant `node_modules/next/dist/docs/` before Next code. Run `graphify update .` before each medium/large checkpoint. Preserve `ProductPage`, current URLs, and Next/Vercel as rollback adapter.
- Work only against an isolated local Supabase stack for schema and HTTP tests. Never reset or restart the shared stack. No production writes, push, deploy, DNS, or R2 changes in this plan.
- `supabase/config.toml` has `[experimental.pgdelta] enabled = true`: edit `supabase/schemas/` first, generate with `supabase db schema declarative sync -f <name> --no-apply`, review the migration, then test locally. Do not use `db diff` as a declarative-schema generator.
- Build capture may hold `ADMIN_SUPABASE_KEY` only in a dedicated Node/server process. Never pass that key, a release capability, or its hash into Next child env, HTML, URL, logs, or a package.
- Do not revoke existing public source grants or wire Worker admin writes until both Worker and legacy readers are compatible and the first release has been seeded and verified.

## Review Focus

1. Empty initial release must fail closed, not silently read editable tables (Task 1 test).
2. Concurrent admin write during capture must not yield a mixed release (Task 2 test).
3. An oversized or malformed release document must fail without partial public visibility (Task 2 test).
4. Missing or wrong pinned-release capability must not fall back to active or source data (Task 4 test).
5. Old Vercel public paths must not expose a pending edit even after direct-table grants are removed (Task 5 test).

---

### Task 1: Private release schema and public read contract

**Files:** `supabase/schemas/zz_catalog_publications.sql` (new), generated `supabase/migrations/<timestamp>_catalog_publications.sql`, `supabase/tests/database/catalog_publications.test.sql` (new), `supabase/schemas/prod.sql` (search function only).

**Interfaces:** `public.search_catalog_products(search_query text DEFAULT NULL, category_filter text DEFAULT NULL, subcategory_filter text DEFAULT NULL, brand_filter text DEFAULT NULL, vehicle_type_filter text DEFAULT NULL, require_no_subcategory boolean DEFAULT false, publication_id uuid DEFAULT NULL, publication_capability text DEFAULT NULL)` retains the existing row type and filter semantics. Add `public.read_catalog_publication_document(kind text, key text, publication_id uuid DEFAULT NULL, publication_capability text DEFAULT NULL) RETURNS jsonb` and `public.list_catalog_publication_documents(kind text, publication_id uuid DEFAULT NULL, publication_capability text DEFAULT NULL) RETURNS SETOF jsonb`. Private release tables and privileged bodies live in a non-exposed schema with fixed empty `search_path`, qualified objects, explicit grants.

- [ ] Write pgTAP RED tests: no active release, anon/authenticated direct-table denial, active read, pinned read only with its capability, wrong/missing capability, revoked/unknown release, filters/count/order and old five/six-argument RPC calls.
- [ ] Run isolated `supabase test db` and real local PostgREST probes; record intended RED failures.
- [ ] Implement append-only release rows/documents/search rows, active pointer, capability hash comparison, one non-ambiguous RPC signature (explicitly remove the obsolete six-argument overload), size bounds, and explicit `REVOKE`/`GRANT` on private/public functions. Generate and inspect pg-delta migration before local apply.
- [ ] Re-run pgTAP and real PostgREST; verify no secret or private row in response/error; checkpoint only schema, migration, and tests.

### Task 2: Complete, consistent release capture

**Files:** `src/cloudflare/static-build/producer/catalog-publication-capture.ts` (new), `scripts/cloudflare/capture-catalog-publication.mjs` (new), `tests/cloudflare-catalog-publication-capture.test.ts` (new), Task 1 SQL files/tests.

**Interfaces:** `captureCatalogPublication({ expectedRevision, releaseId, capabilityHash, source }: CaptureInput): Promise<{ releaseId: string; revision: number; sha256: string; documentCount: number }>`; `source` is a private Node-only port. Captured content covers full `src/types/catalog.ts` fields and all public query dependencies, including product relations/characteristics/images and vehicle showcases. The existing `CatalogSnapshot` v1 stays a route inventory, not a substitute for this full release.

- [ ] Write RED tests for complete-field parity, deterministic hash, empty/missing relation handling, mid-capture write, malformed/oversized data, retry of same ID, and no partially readable release.
- [ ] Run focused tests and isolated SQL/HTTP race fixture; record RED.
- [ ] Implement one database-consistent capture transaction or equivalent atomic SQL function with bounded lock/timeout, expected `content_revision` check, immutable insert, canonical serialization and SHA-256; keep capability value outside persisted plaintext and generated artifacts.
- [ ] Run focused tests, local PostgREST race test, `npm run check`; checkpoint.

### Task 3: Next public reader, pinned build, and legacy active adapter

**Files:** `src/lib/queries/{products,categories,subcategories,brands,vehicle-types,vehicle-hotspots,category-brands}.ts`, `src/lib/supabase/static-build-bindings.ts`, `src/lib/catalog-publication-reader.ts` (new), `src/app/api/health/route.ts`, relevant `tests/*publication-reader*.test.ts` (new).

**Interfaces:** `CatalogPublicationReader` has `list<T>(kind: string): Promise<T[]>` and `get<T>(kind: string, key: string): Promise<T | null>`. `createCatalogPublicationReader({ mode: "active" | "pinned", releaseId?, capability? })` is server-only; build mode receives a local sealed release export, not the admin key or capability. Admin read/write modules continue to use source tables.

- [ ] Write RED tests for all seven query families and health: public data from active release, build from fixed release, full product/detail/SEO/image shape, no source-table fallback on outage, existing `getProducts` pagination and legacy `ProductPage` parity.
- [ ] Run focused tests; record RED. Read relevant installed Next docs before touching App Router code.
- [ ] Route public query modules through the release reader, preserving exported signatures, cache behavior, URLs and legacy search contract; add a scoped build binding with no secret-bearing child env.
- [ ] Run focused tests, `npm run check`, isolated Next build + page/SEO smoke against a real captured release; checkpoint.

### Task 4: Worker search pinned to its own release

**Files:** `src/cloudflare/supabase-catalog-search.ts`, `src/cloudflare/worker.ts`, `src/lib/catalog-search-contract.ts` only if its internal request type needs extension, `tests/cloudflare-*search*.test.ts` (existing/new), workerd fixture.

**Interfaces:** `createPublicCatalogSearchRpc(bindings: PublicSupabaseBindings & { PUBLICATION_ID: string; PUBLICATION_CAPABILITY: string }, fetchImplementation?: typeof fetch): CatalogSearchRpc`. `ProductPage` and `/api/catalog/search` stay unchanged; only the server-side RPC body gains `publication_id` and `publication_capability`.

- [ ] Write RED tests for success, empty/out-of-range, all filters, malformed binding, denied pinned release, Supabase outage, Worker/legacy exact JSON parity, and absence of capability in URL/headers/logs/errors.
- [ ] Run unit and real workerd fixture tests; record RED.
- [ ] Attach pinned args only inside the Worker adapter; fail closed when bindings are absent; keep publishable `apikey` and never use service-role for public search.
- [ ] Run focused tests, `npm run check`, local Wrangler dry-run and measured Worker size; checkpoint.

### Task 5: Deny public source reads only after compatibility proof

**Files:** `supabase/schemas/prod.sql`, generated `supabase/migrations/<timestamp>_private_catalog_source.sql`, `supabase/tests/database/catalog_public_source_access.test.sql` (new), Next/Worker HTTP contract tests.

**Interfaces:** Public `anon`/`authenticated` may execute approved release-read RPCs, but have no direct `SELECT` on editable source tables or exposed source-reading RPCs. Private admin and capture ports retain least-privilege access. No production application of this migration until the compatible legacy deployment is live.

- [ ] Write RED pgTAP/PostgREST tests for every source table, view, and executable function reachable with a publishable key; prove old legacy pages/search still read the active release and pending edits do not appear.
- [ ] Run isolated database and HTTP tests; record RED.
- [ ] Revoke source access and tighten RLS/function grants in declarative schema; generate/review the migration for unintended drops or broad grants. Seed a first release in the isolated stack before enforcing fail-closed reads.
- [ ] Run `supabase test db`, real PostgREST probes, `npm run check`, isolated build/browser checks and security advisor; checkpoint. Mark the migration **not production-applied** in the handoff and pass its ordering gate to Plan B.
