import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectPackageInventory } from "../scripts/cloudflare/package-integrity.mjs";
import { checkLocalPublicRelease } from "../scripts/cloudflare/local-public-release-check.mjs";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function packageFixture() {
  const repoRoot = mkdtempSync(path.join(tmpdir(), "ayprom-public-release-check-"));
  roots.push(repoRoot);
  const packageName = "candidate";
  const packageDir = path.join(repoRoot, "dist", "worker-packages", packageName);
  mkdirSync(path.join(packageDir, "site"), { recursive: true });
  writeFileSync(path.join(packageDir, "site", "index.html"), "<h1>AYPROM</h1>");
  writeFileSync(path.join(packageDir, "worker.js"), "export default { fetch: () => new Response('ok') };");
  writeFileSync(path.join(packageDir, "wrangler.jsonc"), JSON.stringify({
    main: "worker.js", workers_dev: false, assets: { directory: "site", run_worker_first: ["/api/*", "/product/*"] },
  }));
  writeFileSync(path.join(packageDir, "source-revision.json"), JSON.stringify({ schemaVersion: 1, revision: 7 }));
  const inventory = collectPackageInventory(packageDir);
  if (!inventory.ok) throw new Error("fixture_inventory_failed");
  writeFileSync(path.join(packageDir, "package-manifest.json"), JSON.stringify({
    schemaVersion: 1, ready: true, productionReady: false, sourceRevision: 7, inventory: inventory.inventory,
  }));
  return { repoRoot, packageName, packageDir };
}

const expected = {
  health: { status: 200 }, search: { status: 200, slug: "shaft" },
  alias: { status: 308, location: "/catalog/category/pto/shaft" },
  static: { status: 200, contentType: "text/html; charset=utf-8" },
};

describe("local public release check", () => {
  it("runs the packaged Worker between two integrity and catalog revision checks", async () => {
    const candidate = packageFixture();
    let reads = 0;
    let probes = 0;
    const result = await checkLocalPublicRelease({
      ...candidate, readCurrentRevision: async () => { reads += 1; return 7; },
      probePackage: async ({ packageDir }: { packageDir: string }) => {
        probes += 1;
        expect(packageDir).toBe(candidate.packageDir);
        expect(reads).toBe(1);
        return expected;
      },
      expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft",
    });
    expect(result).toEqual({ ok: true, sourceRevision: 7, productionReady: false });
    expect({ reads, probes }).toEqual({ reads: 2, probes: 1 });
  });

  it("never starts a stale or damaged package", async () => {
    const candidate = packageFixture();
    let probes = 0;
    const probePackage = async () => { probes += 1; return expected; };
    expect(await checkLocalPublicRelease({ ...candidate, readCurrentRevision: async () => 8,
      probePackage, expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft" }))
      .toEqual({ ok: false, code: "publication_revision_changed" });
    writeFileSync(path.join(candidate.packageDir, "worker.js"), "corrupt");
    expect(await checkLocalPublicRelease({ ...candidate, readCurrentRevision: async () => 7,
      probePackage, expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft" }))
      .toEqual({ ok: false, code: "package_integrity_failed" });
    expect(probes).toBe(0);
  });

  it("rejects a catalog edit or file edit made during the runtime probe", async () => {
    const first = packageFixture();
    let revision = 7;
    const afterCatalogEdit = await checkLocalPublicRelease({
      ...first, readCurrentRevision: async () => revision,
      probePackage: async () => { revision = 8; return expected; },
      expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft",
    });
    expect(afterCatalogEdit).toEqual({ ok: false, code: "publication_revision_changed" });

    const second = packageFixture();
    const afterFileEdit = await checkLocalPublicRelease({
      ...second, readCurrentRevision: async () => 7,
      probePackage: async () => {
        writeFileSync(path.join(second.packageDir, "worker.js"), "corrupt");
        return expected;
      },
      expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft",
    });
    expect(afterFileEdit).toEqual({ ok: false, code: "package_integrity_failed" });
  });

  it("rejects wrong live responses and hides runtime errors", async () => {
    const candidate = packageFixture();
    const options = { ...candidate, readCurrentRevision: async () => 7,
      expectedSearchSlug: "shaft", expectedAliasPath: "/catalog/category/pto/shaft" };
    expect(await checkLocalPublicRelease({ ...options,
      probePackage: async () => ({ ...expected, alias: { status: 404, location: "/" } }),
    })).toEqual({ ok: false, code: "runtime_probe_failed" });
    const failed = await checkLocalPublicRelease({ ...options,
      probePackage: async () => { throw new Error("private-diagnostic-token"); },
    });
    expect(failed).toEqual({ ok: false, code: "runtime_probe_failed" });
    expect(JSON.stringify(failed)).not.toContain("private-diagnostic-token");
  });
});
