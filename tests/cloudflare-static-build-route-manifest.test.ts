import { describe, expect, it } from "vitest";
import {
  createRouteManifest,
  routePathToOutputFile,
  serializeRouteManifest,
  type RouteManifestEntry,
} from "@/cloudflare/static-build/route-manifest";

const page = (path: string, outputFile: string): RouteManifestEntry => ({
  class: "static",
  family: "category",
  path,
  outputFile,
  expectedCanonical: `https://www.ayprom-gidravlika.kg${path}`,
  expectedJsonLdTypes: ["BreadcrumbList"],
  expectedIndexable: true,
  snapshotIds: ["fixture"],
});

describe("route manifest primitives", () => {
  it.each([
    ["/", "index.html"],
    ["/about", "about.html"],
    ["/catalog/category/pto", "catalog/category/pto.html"],
    ["/robots.txt", "robots.txt"],
    ["/sitemap.xml", "sitemap.xml"],
    ["/404", "404.html"],
  ])("maps %s to %s", (route, file) => {
    expect(routePathToOutputFile(route)).toBe(file);
  });

  it.each([
    "catalog",
    "/catalog/",
    "/catalog?q=x",
    "/catalog#x",
    "/../secret",
    "/a/./b",
    "/a\\b",
    "//catalog",
    "/a/%2F/b",
    "/a/%5c/b",
    "/a/%2e%2e/b",
    "/a/%252e%252e/b",
    "/a/%25255c/b",
    "/NUL",
    "/COM1.txt",
    "/a:bad",
    "/a|bad",
    "/trailing.",
  ])("rejects ambiguous route path %s", (route) => {
    expect(() => routePathToOutputFile(route)).toThrow("invalid route path");
  });

  it("sorts entries by code unit and serializes identical input byte-for-byte", () => {
    const first = createRouteManifest("fixture", [
      page("/catalog", "catalog.html"),
      page("/about", "about.html"),
      page("/", "index.html"),
    ]);
    const second = createRouteManifest("fixture", [
      page("/", "index.html"),
      page("/catalog", "catalog.html"),
      page("/about", "about.html"),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected valid manifests");
    expect(first.value.entries.map((entry) => entry.path)).toEqual([
      "/",
      "/about",
      "/catalog",
    ]);
    expect(serializeRouteManifest(first.value)).toBe(
      serializeRouteManifest(second.value),
    );
    expect(serializeRouteManifest(first.value).endsWith("\n")).toBe(true);
  });

  it("serializes equivalent entries identically regardless of object key order", () => {
    const reordered: RouteManifestEntry = {
      snapshotIds: ["fixture"],
      expectedIndexable: true,
      expectedJsonLdTypes: ["BreadcrumbList"],
      expectedCanonical: "https://www.ayprom-gidravlika.kg/about",
      outputFile: "about.html",
      path: "/about",
      family: "category",
      class: "static",
    };
    const first = createRouteManifest("fixture", [page("/about", "about.html")]);
    const second = createRouteManifest("fixture", [reordered]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected valid manifests");
    expect(serializeRouteManifest(first.value)).toBe(serializeRouteManifest(second.value));
  });

  it("rejects two routes that would write the same output file", () => {
    expect(createRouteManifest("fixture", [
      page("/", "index.html"),
      page("/index", "index.html"),
    ])).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "entries[1].outputFile", rule: "duplicate_output_file" },
      ]),
    });
  });

  it.each([
    [
      [page("/catalog", "catalog.html"), page("/catalog", "catalog.html")],
      "duplicate_path",
    ],
    [
      [page("/Brand", "Brand.html"), page("/brand", "brand.html")],
      "case_insensitive_output_collision",
    ],
    [[page("/catalog", "wrong.html")], "output_mismatch"],
  ] satisfies [RouteManifestEntry[], string][])(
    "rejects route ambiguity with %s",
    (entries, rule) => {
      expect(createRouteManifest("fixture", entries)).toMatchObject({
        ok: false,
        code: "route_manifest_incomplete",
        issues: expect.arrayContaining([expect.objectContaining({ rule })]),
      });
    },
  );

  it("rejects an invalid local redirect target", () => {
    const redirect: RouteManifestEntry = {
      class: "redirect",
      family: "product-alias",
      path: "/product/nsh-32",
      redirectTo: "https://external.example/nsh-32",
      status: 308,
      snapshotIds: ["nsh-32"],
    };

    expect(createRouteManifest("fixture", [redirect])).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "entries[0].redirectTo", rule: "invalid_redirect_target" },
      ]),
    });
  });

  it("rejects a blank snapshot identity", () => {
    expect(createRouteManifest(" ", [page("/", "index.html")])).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([
        { field: "snapshotId", rule: "non_empty_string_required" },
      ]),
    });
  });
});
