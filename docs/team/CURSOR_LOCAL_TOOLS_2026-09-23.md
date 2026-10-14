# Cursor: local AYPROM tools, 2026-09-23

## Scope and safety

User requested parity of core skills and integrations with the existing team.
This setup is local to this Windows user. No cloud-agent provisioning, push,
deploy, DNS change, production database change, OAuth login or service restart
was performed. Existing worktrees and their code were not edited.

Keep the existing task boundaries: read AGENTS.md and PROJECT_BRIEF.md; TDD;
no production writes, push, merge or deploy without explicit authorization;
never use service-role credentials for public catalog search. Keep MCP tool
approvals enabled in Cursor. A skill is guidance, not authorization to deploy.

## Installed skill links

21 directory junctions under `C:/Users/user/.cursor/skills` point to existing
local skill directories, preserving scripts, references and assets:

- Project `.agents/skills`: supabase, supabase-postgres-best-practices,
  graphify, catalog-troubleshoot, browser-testing-with-devtools,
  frontend-design, responsive-design.
- Cloudflare plugin 0.1.2: cloudflare, wrangler, workers-best-practices.
- Vercel plugin 0.50.0: nextjs, react-best-practices, vercel-cli, env-vars,
  deployments-cicd, verification.
- Superpowers plugin 6.4.1: test-driven-development, systematic-debugging,
  verification-before-completion, receiving-code-review, requesting-code-review.

The links make the same source instructions available without maintaining a
second copy. Do not edit shared skill targets through the links. If plugin
cache versions are removed, their links must be repointed. Do not recursively
delete link targets when uninstalling. This is not a cloud synchronization setup.

All 21 SKILL.md entrypoints were checked as readable. Discovery by a fresh
Cursor session has not yet been demonstrated. Client-specific tool names,
browser integrations and orchestration in a skill may require adaptation;
installing instructions does not install the tools they reference.

## MCP configuration

Created `C:/Users/user/.cursor/mcp.json` (user-wide, not in Git):

| Name | Purpose | Remaining verification |
| --- | --- | --- |
| ayprom_supabase_readonly | Project-scoped Supabase with read_only=true | Cursor OAuth and harmless read |
| cloudflare_docs | Official Cloudflare documentation MCP | Cursor discovery and query |
| cloudflare_observability | Official Cloudflare logs/analytics MCP | Cursor OAuth and harmless read |
| vercel | Official Vercel MCP | Cursor OAuth, permissions and harmless read |
| ayprom_search_console | Existing local Node MCP server | Cursor discovery and auth status |

Search Console uses the absolute server path in the main checkout, so its
startup does not depend on a worktree's current directory. Credentials remain
in the existing per-user configuration directory; none were copied or printed.
The server still guards sitemap mutations with an exact confirmation phrase
and an audit log. This is not equivalent to client-side approval: keep Cursor
approvals enabled and do not authorize sitemap writes merely to test setup.

No broad Cloudflare API/DNS write connector was added. Vercel is not a
read-only endpoint; its available write tools must remain approval-gated.
No existing Cursor approval policy was changed. UI settings were not inspected.

## Verification

- MCP JSON parses; five entries present; no embedded credentials.
- All 21 junction targets contain SKILL.md.
- Search Console: `node --test tools/search-console-mcp/test/*.test.mjs`:
  24 passed, 0 failed, including stdio initialize/list-tools/auth-status smoke.
- These checks do not establish successful remote OAuth or live API access
  from Cursor. Open a new Cursor conversation and inspect Skills and MCP.
- No application-code change: application build and full application test suite
  were not rerun for this configuration-only setup.

## Open question

The user's spoken reference to a custom Nginx server is ambiguous. No Nginx
configuration was found in the searched project docs/tools. Search Console MCP
is configured; a separate Nginx integration is not invented or installed.

## References

- https://cursor.com/docs/skills
- https://cursor.com/docs/mcp
- https://github.com/cloudflare/mcp-server-cloudflare
- https://vercel.com/docs/ai-tooling/vercel-mcp

Next: verify Cursor actually lists the skills and MCP servers, complete any
needed browser logins, and test only non-mutating operations. Cloud/mobile
setup remains a separate task.
