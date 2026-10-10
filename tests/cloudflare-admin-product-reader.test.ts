import { expect, it } from "vitest";
import { createAdminProductReader } from "@/cloudflare/admin/product-reader";
const bindings = { SUPABASE_URL: "https://db.example.test", ADMIN_SUPABASE_KEY: "private-test-key" };
const row = { id: "p1", slug: "draft", name: "Pump", article: null, published: false, ignored: "private-extra" };

it("sends a bounded GET with private credentials and the shared search/order plan", async () => {
  let url: URL | undefined;
  let options: RequestInit | undefined;
  const reader = createAdminProductReader(bindings, async (input, init) => {
    url = new URL(String(input)); options = init;
    return Response.json([row], { headers: { "content-range": "50-50/51" } });
  });
  expect(await reader({ q: " Pump,() ", page: 2 })).toEqual({
    items: [{ id: "p1", slug: "draft", name: "Pump", article: null, published: false }], total: 51, page: 2, pageSize: 50, totalPages: 2,
  });
  expect(url?.pathname).toBe("/rest/v1/products");
  expect(url?.searchParams.get("offset")).toBe("50");
  expect(url?.searchParams.get("limit")).toBe("50");
  expect(url?.searchParams.get("or")).toBe("(name.ilike.%Pump%,article.ilike.%Pump%)");
  expect(url?.searchParams.get("order")).toBe("order.asc,id.asc");
  expect(url?.searchParams.has("published")).toBe(false);
  expect(options?.method).toBe("GET");
  expect(new Headers(options?.headers).get("apikey")).toBe("private-test-key");
  expect(options?.redirect).toBe("manual");
});
it("accepts empty results and a valid out-of-range page with exact total", async () => {
  for (const response of [Response.json([], { headers: { "content-range": "*/0" } }), Response.json({}, { status: 416, headers: { "content-range": "*/1" } })]) {
    const page = await createAdminProductReader(bindings, async () => response)({ q: "", page: 2 });
    expect(page.items).toEqual([]);
    expect(page.total).toBe(response.status === 416 ? 1 : 0);
  }
});
it("rejects malformed rows, missing counts, failures, and oversized bodies safely", async () => {
  for (const response of [
    Response.json([{ ...row, published: "yes" }], { headers: { "content-range": "0-0/1" } }),
    Response.json([row]), new Response("private-secret", { status: 500 }),
    new Response("x".repeat(1_048_577), { headers: { "content-range": "*/0" } }),
    Response.json({}, { status: 416, headers: { "content-range": "*/100" } }),
  ]) await expect(createAdminProductReader(bindings, async () => response)({ q: "", page: 1 })).rejects.toThrow("Admin products unavailable");
});

it("returns an empty page when its offset equals the exact total", async () => {
  const reader = createAdminProductReader(bindings, async () => Response.json({}, { status: 416, headers: { "content-range": "*/50" } }));
  expect(await reader({ q: "", page: 2 })).toEqual({ items: [], total: 50, page: 2, pageSize: 50, totalPages: 1 });
});
