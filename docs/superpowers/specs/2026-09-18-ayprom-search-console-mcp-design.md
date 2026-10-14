# AYPROM Search Console MCP Design

## Goal

Provide Codex with authenticated Google Search Console access for the single property `sc-domain:ayprom-gidravlika.kg`, including safe read operations and guarded sitemap mutations.

## Boundaries

- OAuth scope: `https://www.googleapis.com/auth/webmasters`.
- Property is fixed to `sc-domain:ayprom-gidravlika.kg`; callers cannot select another property.
- URL and sitemap inputs must use HTTPS and belong to `ayprom-gidravlika.kg` or one of its subdomains.
- The integration does not expose Sites add/delete because the property already exists and removing it would only risk losing access.
- The integration does not expose Google Indexing API. Google permits that API only for `JobPosting` and livestream `BroadcastEvent` pages, which do not match the AYPROM catalog.
- URL Inspection reports Google's indexed version; it does not run a live test or request indexing.
- No credentials, access tokens, refresh tokens, or audit logs are stored in Git.

## Architecture

The versioned source lives in `tools/search-console-mcp` and includes a valid Codex plugin manifest. The repository `.mcp.json` connects its stdio server for project-aware MCP clients. Codex can load the same server through its protected project config or a personal marketplace installation. OAuth setup is a separate command that opens Google's consent page through a desktop loopback flow.

Credentials and tokens live under `%LOCALAPPDATA%\AYPROM\search-console-mcp` by default. The path can be overridden with `AYPROM_GSC_CONFIG_DIR`. The repository remains the source of truth; installing a personal copy must never copy credentials.

## Tools

Read-only tools:

- `gsc_auth_status`
- `gsc_property_status`
- `gsc_search_analytics`
- `gsc_list_sitemaps`
- `gsc_get_sitemap`
- `gsc_inspect_url`

Write tools:

- `gsc_submit_sitemap`
- `gsc_delete_sitemap`

Each write tool requires both Codex approval and an exact confirmation phrase containing the normalized sitemap URL. Every attempted write records a JSONL audit event without credentials or response bodies.

## Failure handling

- Missing OAuth files return an actionable authentication error without launching a browser from the MCP server.
- Expired access tokens are refreshed using the stored refresh token.
- Google API errors retain status and safe response details but redact authorization data.
- Invalid properties, foreign hosts, HTTP URLs, malformed dates, and invalid confirmation phrases are rejected before network access.
- An audit-log failure blocks write operations so a mutation cannot happen without a local record.

## Verification

- Node tests cover property/URL policy, confirmation phrases, analytics validation, OAuth storage paths, error redaction, and write audit behavior with a fake API client.
- Plugin validation checks the Codex manifest and MCP configuration.
- A local MCP smoke test confirms startup and tool enumeration without contacting Google.
- Live authentication and read verification occur only after the user creates or selects a Google Cloud OAuth desktop client and grants access.
