import { describe, expect, it } from "vitest";
import path from "node:path";
import { isCatalogProductHref, localProbeBindings, probeDocumentFile, resolveExistingProbeSite, scopedPaginationProbeFilters, scopedPaginationProbePaths, selectScopedProbePaths, waitForLocalProbe } from "@/cloudflare/static-build/local-browser-probe";

describe("local frozen-page browser probe boundaries", () => {
  it("selects category and vehicle-type query listings for browser pagination checks", () => {
    expect(scopedPaginationProbePaths([
      { path: "/catalog", family: "catalog", class: "query" },
      { path: "/catalog/category/revision-smoke", family: "category", class: "query" },
      { path: "/catalog/vehicle-type/kran-manipulyator", family: "vehicle-type", class: "query" },
      { path: "/catalog/category/revision-smoke/shaft", family: "product", class: "static" },
      { path: "/catalog/category/other", family: "category", class: "static" },
    ])).toEqual(["/catalog/category/revision-smoke", "/catalog/vehicle-type/kran-manipulyator"]);
  });
  it("includes brand and subcategory listing families in scoped browser checks", () => {
    expect(scopedPaginationProbePaths([
      { path: "/catalog/category/pto/brand/kamaz", family: "category-brand", class: "query" },
      { path: "/catalog/category/hydraulic-pumps/subcategory/gear-pumps", family: "subcategory", class: "query" },
      { path: "/catalog/brand/man/category/hydraulic-pumps/subcategory/gear-pumps", family: "brand-category-subcategory", class: "query" },
    ])).toEqual([
      "/catalog/category/pto/brand/kamaz",
      "/catalog/category/hydraulic-pumps/subcategory/gear-pumps",
      "/catalog/brand/man/category/hydraulic-pumps/subcategory/gear-pumps",
    ]);
  });
  it("maps each listing path to the public search filters the browser must send", () => {
    expect(scopedPaginationProbeFilters("/catalog/category/hydraulic-pumps")).toEqual({ category: "hydraulic-pumps" });
    expect(scopedPaginationProbeFilters("/catalog/vehicle-type/crane")).toEqual({ vehicleType: "crane" });
    expect(scopedPaginationProbeFilters("/catalog/category/pto/brand/kamaz")).toEqual({ category: "pto", brand: "kamaz" });
    expect(scopedPaginationProbeFilters("/catalog/category/hydraulic-pumps/subcategory/gear-pumps")).toEqual({ category: "hydraulic-pumps", subcategory: "gear-pumps" });
    expect(scopedPaginationProbeFilters("/catalog/brand/man/category/hydraulic-pumps/subcategory/gear-pumps")).toEqual({ category: "hydraulic-pumps", subcategory: "gear-pumps", brand: "man" });
    expect(() => scopedPaginationProbeFilters("/catalog/category/hydraulic-pumps/product")).toThrow("local_probe_invalid_path");
  });
  it("limits a diagnostic browser run to explicit paths already in the verified manifest", () => {
    const available = ["/catalog/category/hydraulic-pumps", "/catalog/category/pto/brand/kamaz"];
    expect(selectScopedProbePaths(available, "/catalog/category/pto/brand/kamaz")).toEqual(["/catalog/category/pto/brand/kamaz"]);
    expect(selectScopedProbePaths(available, null)).toEqual(available);
    for (const unsafe of ["/admin", "/catalog/category/unknown", "/catalog/category/pto/brand/kamaz,/admin", "", "/catalog/category/pto/brand/kamaz,/catalog/category/pto/brand/kamaz"]) {
      expect(() => selectScopedProbePaths(available, unsafe)).toThrow("local_probe_invalid_path");
    }
  });
  it("bounds a response body that never finishes instead of hanging the entire probe", async () => {
    await expect(waitForLocalProbe(new Promise<never>(() => {}), 10)).rejects.toThrow("local_probe_timeout");
    await expect(waitForLocalProbe(Promise.resolve({ page: 2 }), 10)).resolves.toEqual({ page: 2 });
  });
  it("recognizes direct as well as nested product cards in a local catalog", () => {
    for (const href of [
      "/catalog/category/revision-smoke/shaft",
      "/catalog/category/pto/brand/kamaz/shaft",
      "/catalog/category/pumps/subcategory/parts/pump",
    ]) expect(isCatalogProductHref(href)).toBe(true);
    for (const href of ["/catalog", "/catalog/category/pto", "/catalog/category/pto/brand/kamaz", "/catalog/category/pto/shaft?token=x"])
      expect(isCatalogProductHref(href)).toBe(false);
  });
  it("accepts only a named staging/site directory, never dist/site or a sibling", () => {
    const repo = path.resolve("C:/ayprom-test");
    const good = path.join(repo, "dist", "staging", "20260925T052923Z-d8f88b11", "site");
    expect(resolveExistingProbeSite(repo, good)).toEqual({
      stagingDir: path.dirname(good), siteDir: good, metaDir: path.join(path.dirname(good), "meta"),
    });
    for (const unsafe of [
      path.join(repo, "dist", "site"), path.join(repo, "dist", "staging", "other"),
      path.join(repo, "dist", "staging", "other", "site", "nested"),
      path.join(repo, "dist", "staging", "..", "site"),
    ]) expect(() => resolveExistingProbeSite(repo, unsafe)).toThrow("local_probe_invalid_site_dir");
  });

  it("accepts only loopback Supabase with a public key", () => {
    expect(localProbeBindings("http://127.0.0.1:54321", "sb_publishable_local")).toEqual({
      SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_local",
    });
  });
  it.each(["https://example.supabase.co", "http://127.0.0.1:54321@evil.test", "http://localhost:54321/path"])("rejects non-local origin %s", (url) => {
    expect(() => localProbeBindings(url, "sb_publishable_local")).toThrow("local_probe_invalid_binding");
  });
  it("rejects service-role and malformed keys without echoing them", () => {
    for (const key of ["sb_secret_private", "bad", `e30.${Buffer.from('{"role":"service_role"}').toString("base64url")}.signature`]) {
      expect(() => localProbeBindings("http://127.0.0.1:54321", key)).toThrow("local_probe_invalid_binding");
    }
  });
  it("accepts a local legacy anon JWT", () => {
    const key = `e30.${Buffer.from('{"role":"anon"}').toString("base64url")}.signature`;
    expect(localProbeBindings("http://localhost:54321", key).SUPABASE_PUBLISHABLE_KEY).toBe(key);
  });
  it("maps only safe page paths, never query strings or traversal", () => {
    expect(probeDocumentFile("/catalog")).toBe("catalog/index.html");
    expect(probeDocumentFile("/")).toBe("index.html");
    for (const path of ["/../escape", "/catalog?q=x", "/bad%2fpath", "//host/path", "/CON", "/a\\b"]) {
      expect(() => probeDocumentFile(path)).toThrow("local_probe_invalid_path");
    }
  });
});
