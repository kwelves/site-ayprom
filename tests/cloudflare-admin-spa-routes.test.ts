import { describe, expect, it } from "vitest";
import { buildRouteTable, matchRoute, resolveServerTree } from "@/cloudflare/admin-spa/routes";

const files = [
  "/src/app/admin/(protected)/page.tsx",
  "/src/app/admin/(protected)/brands/page.tsx",
  "/src/app/admin/(protected)/brands/new/page.tsx",
  "/src/app/admin/(protected)/brands/[slug]/edit/page.tsx",
  "/src/app/admin/(protected)/categories/[slug]/subcategories/[subSlug]/edit/page.tsx",
  "/src/app/admin/login/page.tsx",
  "/src/app/admin/welcome/page.tsx",
];

describe("admin route table", () => {
  const table = buildRouteTable(files);

  it("maps page files to URL patterns and marks pages outside the protected group", () => {
    expect(table.map((route) => [route.pattern, route.protected])).toEqual(
      expect.arrayContaining([
        ["/admin", true],
        ["/admin/brands", true],
        ["/admin/brands/new", true],
        ["/admin/brands/:slug/edit", true],
        ["/admin/login", false],
        ["/admin/welcome", false],
      ]),
    );
  });

  it("prefers a fixed segment over a parameter and extracts parameters", () => {
    expect(matchRoute(table, "/admin/brands/new")?.route.file).toContain("brands/new/page");
    const edit = matchRoute(table, "/admin/brands/gates/edit");
    expect(edit?.params).toEqual({ slug: "gates" });
    expect(matchRoute(table, "/admin/categories/oil/subcategories/hoses/edit")?.params).toEqual({ slug: "oil", subSlug: "hoses" });
  });

  it("decodes parameters, ignores a trailing slash and returns null for unknown paths", () => {
    expect(matchRoute(table, "/admin/brands/%D0%B1%D1%80/edit/")?.params).toEqual({ slug: "бр" });
    expect(matchRoute(table, "/admin/nowhere")).toBeNull();
    expect(matchRoute(table, "/admin/")?.route.pattern).toBe("/admin");
  });
});

describe("resolveServerTree", () => {
  it("awaits async components anywhere in the tree and keeps plain elements", async () => {
    const react = await import("react");
    async function Inner({ label }: { label: string }) {
      await Promise.resolve();
      return react.createElement("em", null, label);
    }
    async function Page() {
      return react.createElement("div", null, react.createElement(Inner, { label: "hi" }), react.createElement("p", null, "plain"));
    }
    const resolved = await resolveServerTree(react.createElement(Page));
    const { renderToStaticMarkup } = await import("react-dom/server");
    expect(renderToStaticMarkup(resolved)).toBe("<div><em>hi</em><p>plain</p></div>");
  });

  it("leaves client components with function children and context providers alone", async () => {
    const react = await import("react");
    const Sync = ({ children }: { children?: React.ReactNode }) => react.createElement("section", null, children);
    const resolved = await resolveServerTree(react.createElement(Sync, null, "text", react.createElement("b", null, "x")));
    const { renderToStaticMarkup } = await import("react-dom/server");
    expect(renderToStaticMarkup(resolved)).toBe("<section>text<b>x</b></section>");
  });
});
