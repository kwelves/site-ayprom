# Next public reader: active-release compatibility increment

This is a local Task 3 checkpoint, not a completed migration or a production switch.
No push, deployment, DNS change, production database write, or shared-stack restart was performed.

## Behavior

- `AYPROM_PUBLIC_CATALOG_READ_MODE=active` routes the seven public query families and the legacy `/api/health` check through the approved publication read RPCs. The flag is off by default while the database rollout has not happened.
- Product search retains the existing `search_catalog_products` and `ProductPage` shape. In active mode, a missing RPC now fails closed instead of invoking the editable-table fallback. Invalid mode values fail before a product request.
- Product detail preserves description, SEO metadata, characteristics, vehicle types, gallery variant and master-image fallback. Sitemap items use the durable master image. Brand/category/subcategory/vehicle routes retain their exported signatures.
- Composite keys use PostgreSQL `jsonb_build_array(... )::text` formatting; JavaScript's compact `JSON.stringify` is not equivalent here.
- The new reader exposes an in-memory pinned-port contract for a future sealed local export. No build runner is connected to that port yet.

## TDD and verification

- The initial reader test was RED because the module did not exist. The seven-family suite was RED, 6/6 failed while queries still hit editable tables. The health check was RED, 503 instead of 200 when the source was unavailable. The composite-key test was RED, 2 cases failed, then GREEN.
- Focused reader/query/health/legacy tests: 27 passed. Later focused reader/query/health run after the composite and full-field checks: 18 passed.
- `npm run check`: exit 0; lint, typecheck and color checks passed; 204 test files passed, 1 skipped, 1848 tests passed, 4 skipped.
- `git diff --check` and Graphify are final checkpoint gates, recorded with the commit.

## Still required before public use

- Active list RPCs are deliberately capped at 999 records. A 1000-row response fails closed rather than being silently truncated by PostgREST. Add release-stable pagination before switching a larger catalog.
- Multi-RPC pages are not yet pinned to one active release while the active pointer is switched. The documents on either side are immutable, but a response could combine the old and new release at that instant. This must be closed or explicitly gated before activation.
- Produce, validate and feed a sealed local release export to the Next build child. The current Workers Build runner still reads mutable source tables and is diagnostic only.
- Run an isolated real Next build and page/SEO smoke against a captured release. Test the active legacy reader against real PostgREST, not only mocked Supabase results.
- Finish pinned Worker search, source-read revocation, release activation/rollback gates and remote cutover separately. Existing public source grants remain unchanged.
