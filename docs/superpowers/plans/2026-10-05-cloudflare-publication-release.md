# Cloudflare Catalog Release and Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved admin edit becomes public only after one verified Worker/assets package and matching immutable data release are live; failures keep the previous release and rollback restores it.

**Architecture:** Extend the existing revisioned Node build, publication queue, staging verifier, and package tooling. A release coordinator owns candidate state, inactive upload, smoke, activation, pointer change, live verification, queue confirmation, and compensating rollback. Admin writes are wired only after this path and the snapshot readers in Plan A pass local and staging gates.

**Tech Stack:** TypeScript/Node, Next.js, Cloudflare Wrangler/Workers, Supabase Postgres/PostgREST, R2, Vitest, Playwright.

**Spec:** [Approved publication consistency design](../specs/2026-10-05-cloudflare-publication-consistency-design.md). **Dependency:** complete [Immutable Catalog Snapshot Plan](2026-10-05-cloudflare-publication-snapshot.md), including a compatible legacy-origin release before source access is revoked.

## Global Constraints

- TDD and local checkpoints per task; `npm run check`, relevant build/workerd/browser/SQL gates, `graphify update .` before medium/large checkpoints. Preserve existing user changes and other worktrees.
- Local fixtures and isolated Supabase first. Remote staging, Cloudflare activation, production SQL, DNS, Vercel, and R2 changes are separate explicit execution gates; a green local test never implies production readiness.
- Keep the free hosting architecture. Sharp stays in external Node; no full vinext runtime; Vercel stays rollback-origin. Never delete old packages, snapshots, or media as part of failure handling.
- No secrets in package, HTML, logs or reports. An unknown upload/activation result is **unknown**, never success; reconcile remote deployment ID before retry or rollback.

## Review Focus

1. A second edit during build or after package creation must invalidate the candidate (Task 1 test).
2. An inactive upload must not move the public route or flip `productionReady` (Task 2 test).
3. Lost activation response must reconcile actual deployment ID before any retry (Task 3 test).
4. Failed rollback or active-pointer update must remain visible as an unresolved incident, not success (Task 3 test).
5. A media overwrite/delete or admin save failure must not mutate the live release (Tasks 4–5 tests).

---

### Task 1: Build and verify one pinned candidate

**Files:** `src/cloudflare/static-build/producer/{revisioned-build,workers-build-runner,publication-queue}.ts`, `scripts/cloudflare/workers-build-runner.mjs`, package manifest/verification modules, `tests/cloudflare-*publication*.test.ts` (existing/new).

**Interfaces:** `buildPublicationCandidate({ jobId, expectedRevision, releaseId, releaseHash, sealedExport, packageDir }: CandidateInput): Promise<{ ok: true; packageDir: string; releaseId: string; revision: number; sha256: string } | { ok: false; code: string; stage: string }>`; package manifest includes release ID/revision/hash, never capability.

- [ ] Write RED tests for pinned document source, two revision fences, missing/extra media and pages, changed source during build/crawl/package, mismatched release hash, malformed reports, and unchanged prior package.
- [ ] Run focused tests; record RED.
- [ ] Integrate Plan A capture/export with existing Next build, crawl, SEO/sitemap/link/media checks and integrity package, with deterministic manifest and candidate-only output under `dist/`.
- [ ] Run `npm run check`, real isolated Next build/HTTP crawl from local Supabase, Wrangler dry-run and browser smoke; checkpoint. Keep `productionReady:false` and no external publication.

### Task 2: Inactive upload and remote preflight adapter

**Files:** `src/cloudflare/publication/cloudflare-version-port.ts` (new), `src/cloudflare/publication/release-journal.ts` (new), CLI under `scripts/cloudflare/` (new), `tests/cloudflare-publication-upload.test.ts` (new).

**Interfaces:** `CloudflareVersionPort.uploadInactive(packageDir): Promise<{ versionId: string }>`; `preview(versionId): Promise<{ url: string }>`; `currentDeployment(): Promise<{ deploymentId: string; versionId: string }>`; `activate(versionId): Promise<{ deploymentId: string }>`; `rollback(versionId): Promise<{ deploymentId: string }>`. Journal stores IDs, package/release hashes, status, timestamps, no credentials. Verify installed Wrangler commands against its `--help` before implementing the real adapter.

- [ ] Write RED fake-port tests: upload success does not activate; failed upload/smoke keeps old deployment; secret redaction, duplicate version, wrong package hash, unknown response and no premature `productionReady`.
- [ ] Run focused tests; record RED.
- [ ] Implement least-privilege version adapter, journal and local fake; inactive preview must use test/limited bindings and compare package ID/hash with pinned release. Do not invoke the real remote adapter in unit/local gates.
- [ ] Run focused tests, `npm run check`, package integrity and local workerd smoke; checkpoint.

### Task 3: Release coordinator, verification, and rollback

**Files:** `src/cloudflare/publication/release-coordinator.ts` (new), `src/cloudflare/static-build/producer/publication-queue.ts`, release journal/CLI, `tests/cloudflare-release-coordinator.test.ts` (new), staged/live probe tests.

**Interfaces:** `publishCandidate({ candidate, cloudflare, activePointer, queue, probe, journal }: PublishInput): Promise<PublicationOutcome>`; `ActivePublicationPointer.compareAndSet(expectedReleaseId, nextReleaseId): Promise<boolean>`; `Probe.verify(versionId, releaseId): Promise<boolean>`. Outcome distinguishes `published`, `failed_old_live`, and `unresolved`; it never guesses remote state.

- [ ] Write RED fault-injection tests at capture/build/crawl/upload/smoke/activation/pointer/live-probe/queue-confirm/rollback boundaries, including lost response, concurrent operator, stale revision and failed compensation.
- [ ] Run focused tests; record RED.
- [ ] Implement ordered activation: recheck revision, upload inactive, smoke candidate, mark release readable by capability, activate Worker+assets, switch legacy active pointer, live-probe, confirm queue. On failure reconcile remote deployment ID and compensate to previous version/pointer; keep immutable artifacts.
- [ ] Run repeated deterministic fault suite, `npm run check`, local workerd and isolated database/browser E2E; checkpoint. Remote staging and production cutover remain explicit gates in the handoff.

### Task 4: Immutable R2 media publication

**Files:** existing media processor/upload adapter in `src/` or `scripts/` after discovery, `src/cloudflare/publication/media-release.ts` (new), `tests/cloudflare-media-release.test.ts` (new), staging verifier.

**Interfaces:** `stageMedia(input): Promise<{ immutableKey: string; sha256: string }>` and `verifyReleaseMedia(releaseId): Promise<{ ok: boolean; missing: string[] }>`; old keys remain addressable while any active/rollback release references them. Preserve the current four image modes and Node/Sharp outputs.

- [ ] Write RED tests for duplicate content, changed bytes/new key, attempted overwrite/delete, missing object, URL parity, and no promotion when media verification fails.
- [ ] Run focused tests; record RED.
- [ ] Implement closed staging, content-addressed or version-unique public keys, verify referenced objects before activation and retention without automatic deletion; no Sharp in Worker.
- [ ] Run processor golden fixtures, media integrity tests, `npm run check`; checkpoint. Use only local/test R2 until a separately authorized remote gate.

### Task 5: Wire admin product writes only behind the publication path

**Files:** `src/cloudflare/worker.ts`, `src/cloudflare/admin/{handler,product-edit-form}.ts`, existing admin product mutation ports, `src/components/admin/product-publication-state.ts` only if reused, `tests/cloudflare-admin-*` (existing/new), live browser E2E.

**Interfaces:** Existing optional `createProduct`/`updateProduct` ports remain; successful save returns `pendingPublicationRevision` from `content_revision`, not a claim that public pages changed. Admin status exposes `pending`, `published`, `failed` from queue/journal without exposing credentials.

- [ ] Write RED tests: authorized save updates source and enqueues one job; old public pages/search/media stay identical; validation/conflict/outage do not enqueue; retry and duplicate save do not falsely mark published; unauthenticated write denied.
- [ ] Run handler/workerd/real isolated PostgREST tests; record RED.
- [ ] Wire narrow mutation ports and pending-state UI only after Tasks 1–4 and Plan A pass, with publication queue idempotency and no direct request-time build. Keep auth/session behavior unchanged.
- [ ] Run `npm run check`, real isolated Next/build/Worker/browser E2E on desktop/mobile, direct PostgREST denial checks and rollback drill; checkpoint. Record remaining remote staging, Worker Free CPU/quota, DNS and production cutover gates without declaring migration complete.
