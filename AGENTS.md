<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Product collaboration

- Treat `PROJECT_BRIEF.md` as living product context, not an immutable implementation script.
- Preserve fixed constraints and security requirements, but propose stronger product or design options when useful.
- When the desired result is unclear, present two or three viable approaches, explain tradeoffs, and recommend one.
- Do not make a major directional change without user approval.
- After every medium or large change, run relevant checks and create a local Git checkpoint with a concise result-focused message. Never push automatically.

# Graphify

- Before the first request in every new session, run `graphify update .` when `graphify-out/graph.json` exists. Run `/graphify .` when no graph exists.
- If Graphify fails, report it once and continue using the source files.
- After a medium or large change, update the graph before creating the checkpoint.
