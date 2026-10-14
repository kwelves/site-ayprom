# Pinned release identity in local Worker package

The local pinned candidate now carries the sealed catalog export's release ID,
revision, and SHA-256 in `package-manifest.json`. The manifest never contains
the private publication capability. A preview package cannot claim this metadata.

Before packaging, the runner reopens the sealed export and checks that its
release ID, revision and digest still match the captured identity. Packaging
also compares the release revision with the staging revision report. Before a
local browser probe starts workerd, it compares the package release identity
with the runtime bindings and expected export digest. A mismatch fails closed.

TDD: two package tests failed before the metadata was implemented; the focused
package tests passed after implementation. A subsequent prelaunch mismatch test
checks that neither a wrong digest nor a wrong release ID starts the Worker.

The isolated `--pinned-build` completed against the local catalog: SQL, HTTP,
capture, real Next build and crawl, Wrangler package, workerd, and browser gate
passed. Its most recent package has `release` metadata matching
`sourceRevision`, and `productionReady: false`. No remote service was changed.

This closes only the package-identity part of release-plan Task 1. Candidate
coordination, all failure-injection cases, remote upload, activation and
rollback remain separate work. Local browser and workerd results do not prove
production routing or Cloudflare Free CPU limits.
