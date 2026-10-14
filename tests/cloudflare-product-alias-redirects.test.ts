import { describe, expect, it } from "vitest";
import { createProductAliasRedirectHandler } from "@/cloudflare/product-alias-redirects";
import { collectProductAliases, serializeAliasWorkerEntry } from "@/cloudflare/static-build/producer/alias-worker";
import type { RouteManifestEntry } from "@/cloudflare/static-build/route-manifest";

const target = "/catalog/category/pto/brand/kamaz/shaft";
const entries: RouteManifestEntry[] = [
  { class: "static", family: "product", path: target, outputFile: "catalog/category/pto/brand/kamaz/shaft.html",
    expectedCanonical: `https://www.ayprom-gidravlika.kg${target}`, expectedJsonLdTypes: ["BreadcrumbList"],
    expectedIndexable: true, snapshotIds: ["shaft"] },
  { class: "redirect", family: "product-alias", path: "/product/shaft", redirectTo: target, status: 308,
    snapshotIds: ["shaft"] },
];

describe("frozen product alias redirects", () => {
  it("redirects exactly one known alias with 308 and never accepts an external target", () => {
    const handle = createProductAliasRedirectHandler(collectProductAliases(entries));
    const redirected = handle(new Request("https://www.ayprom-gidravlika.kg/product/shaft?utm=x"));
    expect(redirected?.status).toBe(308);
    expect(redirected?.headers.get("location")).toBe(`https://www.ayprom-gidravlika.kg${target}`);
    expect(handle(new Request("https://www.ayprom-gidravlika.kg/product/unknown"))).toBeNull();
    expect(handle(new Request("https://www.ayprom-gidravlika.kg/product/shaft", { method: "POST" }))).toBeNull();
    expect(() => createProductAliasRedirectHandler([{ path: "/product/evil", redirectTo: "//evil.test", status: 308 }]))
      .toThrow("invalid_product_alias");
  });

  it("refuses aliases whose target is not a page in the same frozen manifest", () => {
    expect(() => collectProductAliases(entries.slice(1))).toThrow("alias_target_missing");
  });

  it("serializes a deterministic Worker entry without injecting route strings as code", () => {
    const aliases = collectProductAliases(entries);
    const first = serializeAliasWorkerEntry(aliases, "../../../../src/cloudflare/worker.ts", "../../../../src/cloudflare/product-alias-redirects.ts");
    expect(first).toBe(serializeAliasWorkerEntry(aliases, "../../../../src/cloudflare/worker.ts", "../../../../src/cloudflare/product-alias-redirects.ts"));
    expect(first).toContain('"/product/shaft"');
    expect(first).toContain('"/catalog/category/pto/brand/kamaz/shaft"');
    expect(first).not.toContain("sb_secret_");
  });
});
