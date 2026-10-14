import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadCatalogPublicationFile,
  writeCatalogPublicationFile,
} from "@/lib/catalog-publication-file";
import type { CatalogPublicationExport } from "@/cloudflare/static-build/producer/catalog-publication-export";

const releaseId = "20000000-0000-4000-8000-000000000001";
const emptyKinds = { category: [], subcategory: [], brand: [], category_brand: [],
  vehicle_type: [], vehicle_hotspot: [], product: [] };
const fixture: CatalogPublicationExport = { format: 1, releaseId, revision: 5,
  sha256: "a".repeat(64), documentCount: 1,
  documents: { ...emptyKinds, category: [{ slug: "pto", name: "PTO" }] } };
const roots: string[] = [];

async function temporaryRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "ayprom-publication-file-test-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("ayprom-publication-file-test-")) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

describe("local sealed publication file", () => {
  it("writes only a new staging/meta file and reloads it by digest and release ID", async () => {
    const repoRoot = await temporaryRepo();
    const written = await writeCatalogPublicationFile({ repoRoot, publication: fixture });
    expect(written.path).toContain(path.join("dist", "staging"));
    expect(written.path).toContain(`${path.sep}meta${path.sep}catalog-publication-export.json`);
    expect(written.path).not.toContain(`${path.sep}site${path.sep}`);
    expect(await loadCatalogPublicationFile({ repoRoot, path: written.path,
      sha256: written.sha256, releaseId })).toEqual(fixture);
    expect(await readFile(written.path, "utf8")).not.toContain("publication_capability");
  });

  it("fails closed if bytes change after the builder hands off the digest", async () => {
    const repoRoot = await temporaryRepo();
    const written = await writeCatalogPublicationFile({ repoRoot, publication: fixture });
    await writeFile(written.path, JSON.stringify({ ...fixture, revision: 6 }));
    await expect(loadCatalogPublicationFile({ repoRoot, path: written.path,
      sha256: written.sha256, releaseId })).rejects.toThrow("Catalog publication file unavailable");
  });

  it("rejects wrong release identity and paths outside the new staging/meta tree", async () => {
    const repoRoot = await temporaryRepo();
    const written = await writeCatalogPublicationFile({ repoRoot, publication: fixture });
    await expect(loadCatalogPublicationFile({ repoRoot, path: written.path,
      sha256: written.sha256, releaseId: "30000000-0000-4000-8000-000000000001" }))
      .rejects.toThrow("Catalog publication file unavailable");
    await expect(loadCatalogPublicationFile({ repoRoot, path: path.join(repoRoot, "dist", "site", "index.html"),
      sha256: written.sha256, releaseId })).rejects.toThrow("Catalog publication file unavailable");
  });

  it.each([
    { ...fixture, documentCount: 2 },
    { ...fixture, documents: { ...emptyKinds } },
    { ...fixture, documents: { ...fixture.documents, category: [{ slug: "pto" }, { slug: "pto" }] }, documentCount: 2 },
    { ...fixture, documents: { ...fixture.documents, admin_credentials: [{ password: "x" }] } },
  ])("rejects malformed export before creating dist %#", async (publication) => {
    const repoRoot = await temporaryRepo();
    await expect(writeCatalogPublicationFile({ repoRoot, publication: publication as CatalogPublicationExport }))
      .rejects.toThrow("Catalog publication file unavailable");
    await expect(readFile(path.join(repoRoot, "dist", "staging", "catalog-publication-export.json")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });
});
