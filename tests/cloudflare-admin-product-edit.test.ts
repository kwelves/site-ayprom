import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createSessionCodec } from "@/lib/admin/session-codec";
import type { AdminAuthPorts } from "@/cloudflare/admin/contracts";
import type { AdminProductDetail } from "@/cloudflare/admin/product-detail-reader";
import { AdminProductMutationError, type ProductMutationFields } from "@/cloudflare/admin/product-mutation-ports";
import { injectedMarkup, submitEditForm as submitForm } from "./support/no-js-form";

const origin = "https://www.ayprom-gidravlika.kg";
const now = Date.parse("2026-10-04T08:00:00Z");
const secret = "local-admin-product-edit-session-secret-32-bytes";
const updatedAt = "2026-10-04T07:59:59.123456+00:00";
const detail: AdminProductDetail = {
  id: "4d331dcf-4243-4a29-aacd-93c30af433e6", slug: "pump", name: "Pump", categorySlug: "hydraulic-pumps",
  subcategorySlug: "gear", shortDescription: "Short", description: "Line 1\nLine 2", article: "A-1",
  published: true, availability: "out_of_stock", metaTitle: null, metaDescription: "Meta",
  updatedAt, characteristics: [{ attribute: "Pressure", value: "200 bar" }, { attribute: "Flow", value: "40 l/min" }],
  compatibleBrands: ["howo", "faw"], vehicleTypes: ["dump-truck"], hotspotCount: 1,
};
const hostile: AdminProductDetail = {
  ...detail,
  name: '"><script>alert(1)</script>',
  description: "</textarea><script>alert(2)</script>",
  article: "' onmouseover='alert(3)",
  shortDescription: "<img src=x onerror=alert(4)>",
  characteristics: [{ attribute: "<b onclick=alert(5)>", value: "&amp; \"quoted\"" }],
};

function ports(overrides: Partial<AdminAuthPorts> = {}) {
  const adapter: AdminAuthPorts = {
    reserve: vi.fn(), finish: vi.fn(), verifyPassword: vi.fn(), credentialVersion: vi.fn(async () => 1),
    readProduct: vi.fn(async (slug: string) => (slug === "pump" ? detail : null)),
    updateProduct: vi.fn(async () => ({ id: detail.id, updatedAt: "2026-10-04T08:01:00.000001+00:00" })),
    assets: { fetch: vi.fn() }, secret, clientIp: "203.0.113.10", now: () => now,
    ...overrides,
  };
  return adapter;
}

async function session(version = 1) {
  return `admin_session=${await createSessionCodec(secret, () => now).create({ credentialVersion: version })}`;
}

function formPost(path: string, body: URLSearchParams | string, cookie?: string, requestOrigin: string | null = origin) {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (cookie) headers.cookie = cookie;
  if (requestOrigin) headers.origin = requestOrigin;
  return new Request(`${origin}${path}`, { method: "POST", headers, body: String(body) });
}

const fieldsOf = (value: AdminProductDetail, slug = value.slug): ProductMutationFields => ({
  slugBase: slug, name: value.name, categorySlug: value.categorySlug, subcategorySlug: value.subcategorySlug,
  shortDescription: value.shortDescription, description: value.description, article: value.article,
  published: value.published, availability: value.availability, metaTitle: value.metaTitle,
  metaDescription: value.metaDescription, characteristics: value.characteristics,
  compatibleBrands: value.compatibleBrands, vehicleTypes: value.vehicleTypes,
});

describe("protected single-product read API", () => {
  it("returns the exact draft and CAS timestamp only to a current session, never cached", async () => {
    const adapter = ports();
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie: await session() } }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("content-type")).toContain("application/json");
    expect(await response?.json()).toEqual(detail);
    expect(adapter.readProduct).toHaveBeenCalledWith("pump");
  });

  it("checks the session and its password version before reading a draft", async () => {
    const expired = `admin_session=${await createSessionCodec(secret, () => now - 8 * 86_400_000).create({ credentialVersion: 1 })}`;
    for (const [cookie, status] of [[undefined, 401], ["admin_session=forged.value", 401], [expired, 401], [await session(0), 401]] as const) {
      const adapter = ports();
      const headers: Record<string, string> = cookie ? { cookie } : {};
      const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/pump`, { headers }));
      expect(response?.status).toBe(status);
      expect(adapter.readProduct).not.toHaveBeenCalled();
      expect(await response?.text()).not.toContain("Pump");
    }
    const revoked = ports({ credentialVersion: vi.fn(async () => 2) });
    expect((await createAdminHandler(revoked)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie: await session(1) } })))?.status).toBe(401);
    expect(revoked.readProduct).not.toHaveBeenCalled();
    const outage = ports({ credentialVersion: vi.fn(async () => { throw new Error("credential secret detail"); }) });
    const unavailable = await createAdminHandler(outage)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie: await session() } }));
    expect(unavailable?.status).toBe(503);
    expect(await unavailable?.text()).not.toContain("credential secret detail");
    expect(outage.readProduct).not.toHaveBeenCalled();
  });

  it("answers 404 for an absent product, 400 for a malformed slug and 503 without leaking backend errors", async () => {
    const cookie = await session();
    const absent = await createAdminHandler(ports())(new Request(`${origin}/api/admin/products/missing`, { headers: { cookie } }));
    expect(absent?.status).toBe(404);
    expect(await absent?.json()).toEqual({ error: "not_found" });
    const malformed = ports();
    expect((await createAdminHandler(malformed)(new Request(`${origin}/api/admin/products/Bad_Slug`, { headers: { cookie } })))?.status).toBe(400);
    expect(malformed.readProduct).not.toHaveBeenCalled();
    const broken = ports({ readProduct: vi.fn(async () => { throw new Error("postgres private detail"); }) });
    const failed = await createAdminHandler(broken)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie } }));
    expect(failed?.status).toBe(503);
    expect(await failed?.text()).not.toContain("postgres private detail");
    const unwired = ports({ readProduct: undefined });
    expect((await createAdminHandler(unwired)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie } })))?.status).toBe(503);
  });

  it("refuses other methods on one product", async () => {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const adapter = ports();
      const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/pump`, { method, headers: { origin, cookie: await session() } }));
      expect(response?.status).toBe(405);
      expect(adapter.readProduct).not.toHaveBeenCalled();
      expect(adapter.updateProduct).not.toHaveBeenCalled();
    }
  });

  it("round-trips GET into the existing PUT contract without losing any replaced relation", async () => {
    const adapter = ports();
    const cookie = await session();
    const read = await (await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/pump`, { headers: { cookie } })))!.json() as AdminProductDetail;
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/pump`, {
      method: "PUT", headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ newSlug: read.slug, expectedUpdatedAt: read.updatedAt, fields: fieldsOf(read) }),
    }));
    expect(response?.status).toBe(200);
    expect(adapter.updateProduct).toHaveBeenCalledWith({ slug: "pump", newSlug: "pump", expectedUpdatedAt: updatedAt, fields: fieldsOf(detail) });
  });
});

describe("protected HTML edit form without JavaScript", () => {
  it("redirects guests and revoked sessions before reading a draft", async () => {
    const guest = ports();
    const guestPage = await createAdminHandler(guest)(new Request(`${origin}/admin/products/pump/edit`));
    expect(guestPage?.status).toBe(302);
    expect(guestPage?.headers.get("location")).toBe("/admin/login");
    expect(guest.readProduct).not.toHaveBeenCalled();
    const revoked = ports({ credentialVersion: vi.fn(async () => 2) });
    const revokedPage = await createAdminHandler(revoked)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie: await session(1) } }));
    expect(revokedPage?.headers.get("location")).toBe("/admin/login?session=expired");
    expect(revokedPage?.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(revoked.readProduct).not.toHaveBeenCalled();
  });

  it("renders every editable field with a strict no-script CSP and the exact CAS timestamp", async () => {
    const response = await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie: await session() } }));
    expect(response?.status).toBe(200);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(response?.headers.get("x-robots-tag")).toContain("noindex");
    const csp = response?.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("script-src");
    const html = await response!.text();
    expect(html).not.toMatch(/<script\b|\son[a-z]+\s*=/i);
    expect(html).toContain("Товар показан на витрине техники");
    const form = submitForm(html);
    expect(form.action).toBe("/admin/products/pump/edit");
    expect(form.body.get("expectedUpdatedAt")).toBe(updatedAt);
    expect(form.disabled).toBe(false);
  });

  it("escapes hostile product data in text, attributes and textareas", async () => {
    const adapter = ports({ readProduct: vi.fn(async () => hostile) });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie: await session() } }));
    const html = await response!.text();
    // What a browser would build: no injected element and no event-handler attribute.
    expect(injectedMarkup(html)).toEqual([]);
    expect(html).toContain("&lt;/textarea&gt;&lt;script&gt;");
    // A browser would submit the hostile values back unchanged, not executed or truncated.
    const { body } = submitForm(html);
    expect(body.get("name")).toBe(hostile.name);
    expect(body.get("description")).toBe(hostile.description);
    expect(body.get("article")).toBe(hostile.article);
    expect(body.getAll("characteristicAttribute")[0]).toBe("<b onclick=alert(5)>");
    expect(body.getAll("characteristicValue")[0]).toBe("&amp; \"quoted\"");
  });

  it("saves an unchanged form as exactly the stored fields (legacy-equivalent round trip)", async () => {
    const adapter = ports();
    const cookie = await session();
    const page = await createAdminHandler(adapter)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } }));
    const form = submitForm(await page!.text());
    const response = await createAdminHandler(adapter)(formPost(form.action, form.body, cookie));
    expect(response?.status).toBe(303);
    expect(response?.headers.get("location")).toBe("/admin/products/pump/edit?saved=1");
    expect(adapter.updateProduct).toHaveBeenCalledTimes(1);
    expect(adapter.updateProduct).toHaveBeenCalledWith({ slug: "pump", newSlug: "pump", expectedUpdatedAt: updatedAt, fields: fieldsOf(detail) });
  });

  it("normalizes edits like the legacy form: trim, empty to null, slugified address, dropped half rows", async () => {
    const adapter = ports();
    const cookie = await session();
    const form = submitForm(await (await createAdminHandler(adapter)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } })))!.text());
    form.body.set("slug", " Новый Насос ");
    form.body.set("name", "  Renamed  ");
    form.body.set("description", "   ");
    form.body.set("subcategorySlug", "");
    form.body.delete("published");
    form.body.set("compatibleBrands", " howo,  shacman ");
    form.body.set("vehicleTypes", "");
    form.body.append("characteristicAttribute", "Only attribute");
    form.body.append("characteristicValue", " ");
    const response = await createAdminHandler(adapter)(formPost(form.action, form.body, cookie));
    expect(response?.headers.get("location")).toBe("/admin/products/novyy-nasos/edit?saved=1");
    expect(adapter.updateProduct).toHaveBeenCalledWith({
      slug: "pump", newSlug: "novyy-nasos", expectedUpdatedAt: updatedAt,
      fields: { ...fieldsOf(detail, "novyy-nasos"), name: "Renamed", description: null, subcategorySlug: null,
        published: false, compatibleBrands: ["howo", "shacman"], vehicleTypes: [] },
    });
  });

  it("shows a stale edit as a 409 conflict, keeps the typed values and never retries silently", async () => {
    const adapter = ports({ updateProduct: vi.fn(async () => { throw new AdminProductMutationError("conflict"); }) });
    const cookie = await session();
    const form = submitForm(await (await createAdminHandler(adapter)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } })))!.text());
    form.body.set("name", "My unsaved <edit>");
    const response = await createAdminHandler(adapter)(formPost(form.action, form.body, cookie));
    expect(response?.status).toBe(409);
    const html = await response!.text();
    expect(html).toContain("Товар изменён в другом окне или другим администратором");
    expect(html).toContain('href="/admin/products/pump/edit"');
    expect(html).toContain("My unsaved &lt;edit&gt;");
    expect(submitForm(html).body.get("expectedUpdatedAt")).toBe(updatedAt);
    expect(adapter.updateProduct).toHaveBeenCalledTimes(1);
  });

  it("shows invalid references and backend failures without database details", async () => {
    const cookie = await session();
    const form = submitForm(await (await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } })))!.text());
    for (const [error, status, message] of [
      [new AdminProductMutationError("input_invalid"), 400, "Проверьте адрес, категорию"],
      [new AdminProductMutationError("backend_unavailable"), 503, "Не удалось сохранить товар"],
      [new Error("relation \"products\" private stack sb_secret_x"), 503, "Не удалось сохранить товар"],
    ] as const) {
      const adapter = ports({ updateProduct: vi.fn(async () => { throw error; }) });
      const response = await createAdminHandler(adapter)(formPost(form.action, form.body, cookie));
      expect(response?.status).toBe(status);
      const html = await response!.text();
      expect(html).toContain(message);
      expect(html).not.toMatch(/private stack|sb_secret|relation/);
    }
  });

  it("rejects required fields and an empty address with the legacy messages and no write", async () => {
    const cookie = await session();
    const form = submitForm(await (await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } })))!.text());
    for (const [field, value, message] of [
      ["name", "  ", "Заполните обязательные поля: название, категория."],
      ["categorySlug", "", "Заполните обязательные поля: название, категория."],
      ["slug", "!!!", "Укажите адрес товара: латинские буквы, цифры и дефисы."],
    ] as const) {
      const adapter = ports();
      const body = new URLSearchParams(form.body);
      body.set(field, value);
      const response = await createAdminHandler(adapter)(formPost(form.action, body, cookie));
      expect(response?.status).toBe(400);
      expect(await response!.text()).toContain(message);
      expect(adapter.updateProduct).not.toHaveBeenCalled();
    }
  });

  it("writes nothing for a guest, a revoked session, a foreign or missing Origin", async () => {
    const form = submitForm(await (await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie: await session() } })))!.text());
    const cases = [
      { adapter: ports(), cookie: undefined, origin, status: 303, location: "/admin/login" },
      { adapter: ports({ credentialVersion: vi.fn(async () => 2) }), cookie: await session(1), origin, status: 303, location: "/admin/login?session=expired" },
      { adapter: ports({ credentialVersion: vi.fn(async () => { throw new Error("x"); }) }), cookie: await session(), origin, status: 303, location: "/admin/login?session=unavailable" },
      { adapter: ports(), cookie: await session(), origin: "https://attacker.example", status: 400, location: null },
      { adapter: ports(), cookie: await session(), origin: null, status: 400, location: null },
    ];
    for (const item of cases) {
      const response = await createAdminHandler(item.adapter)(formPost(form.action, form.body, item.cookie, item.origin));
      expect(response?.status).toBe(item.status);
      expect(response?.headers.get("location")).toBe(item.location);
      expect(item.adapter.updateProduct).not.toHaveBeenCalled();
      expect(item.adapter.readProduct).not.toHaveBeenCalled();
    }
  });

  it("rejects oversized, malformed and unexpected form bodies before writing", async () => {
    const cookie = await session();
    const form = submitForm(await (await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } })))!.text());
    const withExtra = new URLSearchParams(form.body); withExtra.append("p_published", "true");
    const duplicate = new URLSearchParams(form.body); duplicate.append("name", "second");
    const noVersion = new URLSearchParams(form.body); noVersion.delete("expectedUpdatedAt");
    const badVersion = new URLSearchParams(form.body); badVersion.set("expectedUpdatedAt", "yesterday");
    const badAvailability = new URLSearchParams(form.body); badAvailability.set("availability", "sold");
    const huge = new URLSearchParams(form.body); huge.set("description", "x".repeat(70_000));
    const manyRows = new URLSearchParams(form.body);
    for (let index = 0; index < 101; index += 1) { manyRows.append("characteristicAttribute", `a${index}`); manyRows.append("characteristicValue", "v"); }
    for (const body of [withExtra, duplicate, noVersion, badVersion, badAvailability, huge, manyRows]) {
      const adapter = ports();
      const response = await createAdminHandler(adapter)(formPost(form.action, body, cookie));
      expect(response?.status).toBe(400);
      expect(adapter.updateProduct).not.toHaveBeenCalled();
    }
    const json = ports();
    const wrongType = await createAdminHandler(json)(new Request(`${origin}${form.action}`, {
      method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: "{}",
    }));
    expect(wrongType?.status).toBe(400);
    expect(json.updateProduct).not.toHaveBeenCalled();
  });

  it("keeps saving disabled when the deployment has no product write port", async () => {
    const adapter = ports({ updateProduct: undefined });
    const cookie = await session();
    const page = await createAdminHandler(adapter)(new Request(`${origin}/admin/products/pump/edit`, { headers: { cookie } }));
    const html = await page!.text();
    expect(html).toContain("Сохранение отключено");
    const form = submitForm(html);
    expect(form.disabled).toBe(true);
    const response = await createAdminHandler(adapter)(formPost(form.action, form.body, cookie));
    expect(response?.status).toBe(503);
    expect(await response!.text()).toContain("Сохранение отключено");
  });

  it("shows a saved notice and a 404 page for an unknown or malformed product", async () => {
    const cookie = await session();
    const saved = await createAdminHandler(ports())(new Request(`${origin}/admin/products/pump/edit?saved=1`, { headers: { cookie } }));
    expect(await saved!.text()).toContain("Изменения сохранены.");
    const absent = await createAdminHandler(ports())(new Request(`${origin}/admin/products/missing/edit`, { headers: { cookie } }));
    expect(absent?.status).toBe(404);
    expect(await absent!.text()).toContain("Товар не найден");
    const malformed = ports();
    expect((await createAdminHandler(malformed)(new Request(`${origin}/admin/products/Bad_Slug/edit`, { headers: { cookie } })))?.status).toBe(404);
    expect(malformed.readProduct).not.toHaveBeenCalled();
  });

  it("links every product row of the read-only list to its edit form", async () => {
    const adapter = ports({
      readProducts: vi.fn(async () => ({ items: [{ id: detail.id, slug: "pump", name: "Pump", article: null, published: true }], page: 1, pageSize: 50, total: 1, totalPages: 1 })),
    });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/admin/products`, { headers: { cookie: await session() } }));
    expect(await response!.text()).toContain('href="/admin/products/pump/edit"');
  });
});
