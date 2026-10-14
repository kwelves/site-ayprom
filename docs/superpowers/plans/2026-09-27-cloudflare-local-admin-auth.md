# Cloudflare Local Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove a one-password admin login, session gate, and logout in a local thin Worker against a separate local Supabase Auth instance without changing the live Next/Vercel login.

**Architecture:** Extract a Web Crypto session codec behind the unchanged legacy adapter. Add framework-neutral Worker auth handlers with injected verifier, rate-limit, version, assets, and clock ports; a Cloudflare adapter supplies per-request bindings and a private Supabase client. Use a dedicated local static login/admin fixture and an isolated Supabase project for end-to-end proof. This is not a deployable admin package or CRUD migration.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers/Static Assets, Wrangler/workerd, Supabase Auth/PostgREST, local Docker Supabase, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-cloudflare-local-admin-auth-design.md`

**Коротко для владельца:** Сначала сохраняем совместимость существующих сессий и проверяем защиту входа тестами. Затем собираем отдельную локальную страницу входа и проверяем её в настоящем браузере с отдельной тестовой базой Supabase. Основная админка, production и общий локальный стенд остаются нетронутыми; даже успешный прототип не означает готовность к публикации.

## Global Constraints

- Local-only. No push, deploy, DNS, production Supabase/R2/Vercel changes, or changes to the shared local Supabase stack.
- Keep Next/Vercel login and public catalog search as working legacy/public adapters; never give the public search path a service-role key.
- No real admin CRUD, password change, or production credential migration in this plan.
- No secrets, Auth tokens, passwords, or raw upstream errors in static files, URLs, browser storage, logs, or test reports.
- Reserve a login attempt before password verification; any mandatory RPC/verifier/session-version failure denies access.
- Use TDD (observable RED then GREEN) for each behavior and checkpoint only owned files after checks and Graphify.
- Read the installed `node_modules/next/dist/docs/` guides before modifying any Next code; no Next UI change is planned here.

## Review Focus

- A valid Supabase Auth login for the *wrong* user ID must still be rejected; Task 3 pins this.
- A missing or forged `Origin`, even on a no-JavaScript form POST, must be denied before verifier work; Task 4 pins this.
- A direct request for `/admin` or `/admin/*` with absent, tampered, expired, or old-version cookie must never serve the shell; Task 5 pins this.
- A temporarily unavailable rate-limit RPC or version lookup must never issue a cookie or expose a protected asset; Tasks 3 and 5 pin this.
- Static login error query parameters and upstream errors must not inject markup, disclose secrets, or become publicly cached; Tasks 4 and 6 pin this.

---

### Task 1: Preserve the session contract behind an injected codec

**Files:**
- Create: `src/lib/admin/session-codec.ts` — platform-neutral HMAC token logic with injected secret and clock.
- Modify: `src/lib/admin/session.ts` — thin legacy adapter that reads `ADMIN_SESSION_SECRET` and preserves existing exports.
- Test: `tests/session-codec.test.ts`; extend `tests/session.test.ts`.

**Interfaces:**
- Produce: `createSessionCodec(secret: string, now: () => number): { create(options?: { originalIssuedAt?: number; credentialVersion?: number }): Promise<string>; read(token: string | undefined): Promise<SessionPayload | null> }`.
- Preserve: `createSessionToken`, `getSessionPayload`, `verifySessionToken`, and existing duration constants from `src/lib/admin/session.ts`.

- [ ] Write tests for legacy↔codec token byte parity at a fixed time/secret, missing version = 1, changed signature, expiry, 30-day absolute lifetime, and refresh within the final hour.
- [ ] Run `npx vitest run tests/session-codec.test.ts tests/session.test.ts --maxWorkers=2`; verify a meaningful RED failure before implementation.
- [ ] Extract the codec without `requireServerEnv` or Next imports, then delegate the old exports to it.
- [ ] Re-run the same tests to GREEN; run `npm run typecheck`; commit the isolated codec change.

### Task 2: Define narrow Worker auth ports and validate request shape

**Files:**
- Create: `src/cloudflare/admin/contracts.ts` — typed interfaces for verifier, atomic reservation, version reader, assets, and time.
- Create: `src/cloudflare/admin/request.ts` — body, method, origin, and cookie parsing helpers.
- Test: `tests/cloudflare-admin-request.test.ts`.

**Interfaces:**
- Produce: `AdminAuthPorts` with `reserve(keyHash): Promise<{ allowed: boolean; retryAfter: number; reservationId: string | null }>`, `finish(id: string, valid: boolean): Promise<number>`, `verifyPassword(password: string): Promise<boolean>`, `credentialVersion(): Promise<number>`, `assets: { fetch(request: Request): Promise<Response> }`, `secret: string`, `clientIp: string`, and `now: () => number`.
- Produce: `readLoginRequest(request: Request): Promise<{ password: string } | null>` and `hasSameOrigin(request: Request): boolean`.

- [ ] Test correct form encoding, exactly one password, bounded body size, missing/foreign `Origin`, unsupported method/content type, malformed cookie, and rejection before any port call.
- [ ] Run `npx vitest run tests/cloudflare-admin-request.test.ts --maxWorkers=2` for RED.
- [ ] Implement request helpers with fixed limits (password at most 1 KiB; body at most 4 KiB) and no attacker text in returned errors.
- [ ] Re-run for GREEN; commit the request boundary.

### Task 3: Implement private Supabase adapter without shared Auth state

**Files:**
- Create: `src/cloudflare/admin/supabase-ports.ts` — per-request Auth and PostgREST HTTP calls.
- Test: `tests/cloudflare-admin-supabase-ports.test.ts`.

**Interfaces:**
- Consume: `AdminAuthPorts` from Task 2.
- Produce: `createSupabaseAdminPorts(bindings: AdminBindings, fetcher?: typeof fetch): Pick<AdminAuthPorts, "reserve" | "finish" | "verifyPassword" | "credentialVersion">`; `AdminBindings` uses `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `ADMIN_SUPABASE_KEY` (server-only), `ADMIN_AUTH_EMAIL`, and `ADMIN_AUTH_USER_ID`. `ADMIN_COOKIE_HMAC_KEY` is a separate Worker binding whose *value* matches the legacy session secret only in the isolated parity test.

- [ ] Check current Supabase Auth/PostgREST docs and the changelog; test exact RPC payloads (`begin_admin_auth_attempt`: scope `login`, TTL 30 s, concurrency 3; `finish_admin_auth_attempt`), service-role-only headers, fixed ID match, missing `admin_credentials` row → version 1, and malformed/upstream-error fail-closed behavior. Assert public-key-only Auth call and no token propagation.
- [ ] Run `npx vitest run tests/cloudflare-admin-supabase-ports.test.ts --maxWorkers=2` for RED.
- [ ] Implement fetch-based calls with no singleton Auth client, no mutable token cache, and a bounded (≤10 s) credential-version cache only if its invalidation/expiry semantics are proven by tests; otherwise omit the cache in this prototype.
- [ ] Re-run for GREEN; run `npm run typecheck`; commit the private adapter.

### Task 4: Route login and logout through framework-neutral handlers

**Files:**
- Create: `src/cloudflare/admin/handler.ts` — login/logout flow and static login response.
- Test: `tests/cloudflare-admin-handler.test.ts`.

**Interfaces:**
- Consume: `AdminAuthPorts`, request helpers, and session codec.
- Produce: `createAdminHandler(ports: AdminAuthPorts): (request: Request) => Promise<Response | null>`; `null` means route is outside `/admin` and `/api/admin`.

- [ ] Test POST login valid/wrong password, rate-limited reservation, `finish` failure, verifier failure, same-origin failure, duplicate/missing password, and no cookie on any failure. Assert 303 redirects and sanitized `error=1|rate|security`/bounded `retry` only.
- [ ] Run `npx vitest run tests/cloudflare-admin-handler.test.ts --maxWorkers=2` for RED.
- [ ] Implement reserve → verify → finish → sign order, HMAC attempt key from secret/scope/trusted `clientIp`, no raw password/error logging, `HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`, and `Secure` on HTTPS.
- [ ] Add tests for POST logout with same-origin check and clearing cookie; implement; re-run for GREEN; commit the login/logout handler.

### Task 5: Gate admin assets without broadening public routing

**Files:**
- Modify: `src/cloudflare/admin/handler.ts` — session verification, version check, shell and login asset handling.
- Modify: `src/cloudflare/worker.ts` — per-request admin dispatch before existing public API dispatch.
- Create: `wrangler.admin-local.jsonc` — local-only fixture assets with `/admin`, `/admin/*`, and `/api/*` worker-first; do not change the existing package builder or its deployability claim.
- Test: `tests/cloudflare-admin-handler.test.ts`; extend `tests/cloudflare-worker-package.test.ts`.

**Interfaces:**
- Consume: handler from Task 4 and `env.ASSETS.fetch` binding.
- Preserve: `createCloudflareWorkerApi` public search/health behavior unchanged.

- [ ] Test guest/tampered/expired/old-version cookies, version outage, `/admin/login` guest page, valid shell, final-hour refresh with original `iat`, `/api/admin/*` default denial, `/api/catalog/search` unchanged, and route precedence over static asset fallback.
- [ ] Run targeted Vitest for RED.
- [ ] Route `/admin`, `/admin/*`, and `/api/admin/*` through the handler; return only an allowlisted static login/shell asset through `ASSETS.fetch`, with no-store plus explicit Worker HTML security headers. Unknown admin paths remain denied/404. Missing admin bindings fail closed only on admin routes; public health/search still work.
- [ ] Re-run targeted tests for GREEN; run `npm run typecheck`; commit the routing gate.

### Task 6: Give the local prototype safe HTML and isolated real-service proof

**Files:**
- Create: `fixtures/cloudflare-admin-assets/admin/login.html` and `fixtures/cloudflare-admin-assets/admin.html` — no-JavaScript, no-secret login and empty shell.
- Create: `scripts/cloudflare/local-admin-auth-smoke.mjs` — isolated stack verification, local workerd/browser checks, and sanitized report.
- Test: `tests/cloudflare-admin-local-smoke.test.ts` (unit harness); add Playwright checks only in the isolated test suite.
- Update: `docs/CLOUDFLARE_PARITY_REGISTRY.md` and a dated report under `docs/superpowers/reports/` with exact local evidence and remaining blockers.

**Interfaces:**
- Consume: Task 5 handler/config and local fixture assets.
- Produce: reproducible local-only smoke command and report; no deployable or production-ready artifact.

- [ ] Test error/retry query escaping and whitelist, no-JS form POST, all login/shell responses `Cache-Control: no-store`, no secret material in HTML/JS/report, and failure if admin assets are missing.
- [ ] Run targeted Vitest for RED, implement fixture rendering and harness, then GREEN.
- [ ] Inspect `supabase --help` and exact occupied ports/containers; launch only a uniquely named isolated local Supabase project with its own ports/data, never the shared stack. Seed only its test Auth identity and test credential-version row.
- [ ] Against real local workerd and isolated Supabase, exercise success/wrong password, parallel reservations, replay/expiry/version failure, CSRF/Origin, logout, absent backend, direct `/admin` and `/api/admin/*` requests, and no-JavaScript browser navigation. Tear down only owned processes; leave shared services untouched. Do not run the existing cleanup-bearing E2E suite against the shared database.
- [ ] Run `npm run check`, `npm run build`, local Wrangler dry-run, smoke suite, `git diff --check`, and `graphify update .`. Record raw/gzip Worker size, results, gaps, exact HEAD/status; make a local Git checkpoint of owned files only.

## Stop line

The outcome is **local auth-prototype verified** only if Task 6 succeeds. It is not `ADM-01`/`ADM-02` production parity: full admin pages/API, static-producer inclusion, secret-safe package verification, remote Cloudflare CPU/bindings, live credential transition, and rollback remain separate gates. Do not push or deploy.
