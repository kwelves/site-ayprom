import { verifyPackagedWorker } from "./package-worker-assets-lib.mjs";
import { resolvePublicPackage } from "./resolve-public-package.mjs";

// Local diagnostic only: a passing result never authorizes remote publication.
export async function checkLocalPublicRelease({
  repoRoot, packageName, readCurrentRevision, supabaseUrl = undefined, publishableKey = undefined,
  searchQuery = "shaft", aliasPath = "/product/shaft", staticPath = undefined,
  expectedSearchSlug, expectedAliasPath, probePackage = verifyPackagedWorker,
}) {
  if (typeof expectedSearchSlug !== "string" || expectedSearchSlug.length === 0
    || typeof expectedAliasPath !== "string" || !expectedAliasPath.startsWith("/")
    || typeof probePackage !== "function") return { ok: false, code: "invalid_arguments" };

  const before = await resolvePublicPackage({ repoRoot, packageName, readCurrentRevision });
  if (!before.ok) return before;

  let probe;
  try {
    probe = await probePackage({
      packageDir: before.packageDir, supabaseUrl, publishableKey,
      searchQuery, aliasPath, staticPath: staticPath ?? expectedAliasPath,
    });
  } catch {
    return { ok: false, code: "runtime_probe_failed" };
  }
  if (probe?.health?.status !== 200 || probe?.search?.status !== 200
    || probe.search.slug !== expectedSearchSlug
    || probe.alias?.status !== 308 || probe.alias.location !== expectedAliasPath
    || probe.static?.status !== 200
    || typeof probe.static.contentType !== "string"
    || !probe.static.contentType.toLowerCase().startsWith("text/html")) {
    return { ok: false, code: "runtime_probe_failed" };
  }

  const after = await resolvePublicPackage({ repoRoot, packageName, readCurrentRevision });
  if (!after.ok) return after;
  if (after.packageDir !== before.packageDir || after.sourceRevision !== before.sourceRevision) {
    return { ok: false, code: "publication_revision_changed" };
  }
  return { ok: true, sourceRevision: after.sourceRevision, productionReady: false };
}
