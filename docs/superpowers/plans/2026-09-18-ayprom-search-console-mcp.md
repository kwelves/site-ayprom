# AYPROM Search Console MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install a guarded Codex MCP integration for Google Search Console property `sc-domain:ayprom-gidravlika.kg`.

**Architecture:** A repository-owned Node.js ESM plugin exposes a stdio MCP server. A separate OAuth desktop-flow command stores credentials outside Git, while tool handlers enforce one property, same-domain URLs, exact write confirmations, and append-only mutation auditing.

**Tech Stack:** Node.js 20+, `@modelcontextprotocol/sdk`, Zod, native `fetch`, Node test runner, Google Search Console REST API.

**Spec:** `docs/superpowers/specs/2026-09-18-ayprom-search-console-mcp-design.md`

## Global Constraints

- OAuth scope is exactly `https://www.googleapis.com/auth/webmasters`.
- Allowed property is exactly `sc-domain:ayprom-gidravlika.kg`.
- Secrets and tokens must stay outside the repository.
- Write tools must require exact confirmation and an audit record before the Google request.
- Do not call Google APIs during automated tests.
- Do not expose ordinary URL indexing requests.

---

### Task 1: Policy and configuration core

**Files:**
- Create: `tools/search-console-mcp/package.json`
- Create: `tools/search-console-mcp/src/config.mjs`
- Create: `tools/search-console-mcp/src/policy.mjs`
- Test: `tools/search-console-mcp/test/policy.test.mjs`

**Interfaces:**
- Produces: `loadConfig(env)`, `assertAllowedUrl(value)`, `normalizeSitemapUrl(value)`, `requireWriteConfirmation(action, url, confirmation)`.

- [x] Write tests for fixed property, local config paths, HTTPS/domain checks, URL normalization, and exact confirmation phrases.
- [x] Run `npm test` and verify RED because the modules do not exist.
- [x] Implement the smallest configuration and policy modules that satisfy the tests.
- [x] Run `npm test` and verify GREEN.

### Task 2: OAuth and Google REST client

**Files:**
- Create: `tools/search-console-mcp/src/oauth-store.mjs`
- Create: `tools/search-console-mcp/src/google-client.mjs`
- Create: `tools/search-console-mcp/auth.mjs`
- Test: `tools/search-console-mcp/test/oauth-store.test.mjs`
- Test: `tools/search-console-mcp/test/google-client.test.mjs`

**Interfaces:**
- Consumes: `loadConfig(env)`.
- Produces: `loadOAuthClient()`, `loadToken()`, `saveToken()`, `createSearchConsoleClient(options)`.

- [x] Write failing tests for credential parsing, token persistence, refresh behavior, API URL encoding, and safe Google errors.
- [x] Run the focused tests and verify expected RED failures.
- [x] Implement filesystem storage, token refresh, REST requests, and the loopback OAuth command.
- [x] Run focused tests and verify GREEN.

### Task 3: Tool handlers and mutation audit

**Files:**
- Create: `tools/search-console-mcp/src/audit-log.mjs`
- Create: `tools/search-console-mcp/src/tool-handlers.mjs`
- Test: `tools/search-console-mcp/test/tool-handlers.test.mjs`

**Interfaces:**
- Consumes: Search Console client methods and policy functions.
- Produces: `createToolHandlers({ client, config, appendAudit })`.

- [x] Write failing tests for property status, analytics requests, URL inspection, sitemap reads, rejected writes, pre-write audit ordering, and API failure audit results.
- [x] Run focused tests and verify expected RED failures.
- [x] Implement handlers with injected dependencies and JSON-safe return values.
- [x] Run focused tests and verify GREEN.

### Task 4: MCP server and plugin package

**Files:**
- Create: `tools/search-console-mcp/server.mjs`
- Create: `tools/search-console-mcp/.mcp.json`
- Create: `tools/search-console-mcp/.codex-plugin/plugin.json`
- Create: `tools/search-console-mcp/README.md`
- Test: `tools/search-console-mcp/test/server-smoke.test.mjs`

**Interfaces:**
- Consumes: `createToolHandlers()`.
- Produces: eight named stdio MCP tools and a valid personal-plugin package.

- [x] Write a failing smoke test that starts the server and lists the expected tools over stdio.
- [x] Run the smoke test and verify RED because the server/package is absent.
- [x] Register read and write tools, marking write tools for prompt approval in `.mcp.json`.
- [x] Add setup documentation with exact Google Cloud and local authorization steps.
- [x] Run the smoke test, complete test suite, and plugin validator.

### Task 5: Connect and verify locally

**Files:**
- Modify: `.mcp.json`
- Optional outside Git: `%USERPROFILE%\plugins\ayprom-search-console`
- Optional outside Git: `%USERPROFILE%\.agents\plugins\marketplace.json`

**Interfaces:**
- Consumes: validated source under `tools/search-console-mcp`.
- Produces: project MCP configuration and, when local permissions allow, an installed personal plugin.

- [x] Connect the stdio server through the repository `.mcp.json` with prompt approval for write tools.
- [x] Run local tool-listing and authentication-status smoke verification without Google credentials.
- [x] Update Graphify and run the isolated plugin checks plus the full repository check.
- [ ] Add the server to protected `.codex/config.toml` or install the personal marketplace copy; sandbox permission was not granted.
- [ ] Create the Google OAuth desktop client, authorize the Search Console account, and verify live reads.
- [ ] Create a local Git checkpoint without push or deploy.
