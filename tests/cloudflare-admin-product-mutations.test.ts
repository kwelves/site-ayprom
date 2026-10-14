import { describe, expect, it, vi } from "vitest";
import { createAdminHandler } from "@/cloudflare/admin/handler";
import { createSessionCodec } from "@/lib/admin/session-codec";
import type { AdminAuthPorts } from "@/cloudflare/admin/contracts";
import { AdminProductMutationError } from "@/cloudflare/admin/product-mutation-ports";

const origin = "https://www.ayprom-gidravlika.kg";
const now = Date.parse("2026-10-04T08:00:00Z");
const secret = "local-admin-product-mutation-session-secret-32-bytes";
const fields = {
  slugBase: "test-pump", name: "Test pump", categorySlug: "hydraulic-pumps", subcategorySlug: null,
  shortDescription: "", description: null, article: null, published: false,
  availability: "in_stock" as const, metaTitle: null, metaDescription: null,
  characteristics: [], compatibleBrands: [], vehicleTypes: [],
};

function ports(): AdminAuthPorts {
  return {
    reserve: vi.fn(), finish: vi.fn(), verifyPassword: vi.fn(), credentialVersion: vi.fn(async () => 1),
    createProduct: vi.fn(async () => ({ id: "4d331dcf-4243-4a29-aacd-93c30af433e6", slug: "test-pump" })),
    updateProduct: vi.fn(async () => ({ id: "4d331dcf-4243-4a29-aacd-93c30af433e6", updatedAt: "2026-10-04T08:01:00Z" })),
    assets: { fetch: vi.fn() }, secret, clientIp: "203.0.113.10", now: () => now,
  };
}

describe("protected Cloudflare product mutation API", () => {
  it("creates a product only with a current admin session and same-origin request", async () => {
    const adapter = ports();
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const request = new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const response = await createAdminHandler(adapter)(request);
    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual({ id: "4d331dcf-4243-4a29-aacd-93c30af433e6", slug: "test-pump" });
    expect(adapter.createProduct).toHaveBeenCalledWith(fields);
  });

  it("never writes when the admin session is absent", async () => {
    const adapter = ports();
    const request = new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(fields),
    });
    const response = await createAdminHandler(adapter)(request);
    expect(response?.status).toBe(401);
    expect(adapter.createProduct).not.toHaveBeenCalled();
  });

  it("rejects a foreign Origin before writing", async () => {
    const adapter = ports();
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin: "https://attacker.example", cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    }));
    expect(response?.status).toBe(400);
    expect(adapter.createProduct).not.toHaveBeenCalled();
  });

  it("rejects an old credential version before writing", async () => {
    const adapter = ports();
    adapter.credentialVersion = vi.fn(async () => 2);
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    }));
    expect(response?.status).toBe(401);
    expect(adapter.createProduct).not.toHaveBeenCalled();
  });

  it("rejects malformed or oversized JSON without invoking the mutation port", async () => {
    const adapter = ports();
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    for (const body of ["{", "x".repeat(65_537)]) {
      const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products`, {
        method: "POST", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" }, body,
      }));
      expect(response?.status).toBe(400);
    }
    expect(adapter.createProduct).not.toHaveBeenCalled();
  });

  it("fails closed without a mutation port and does not expose backend errors", async () => {
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const request = () => new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    const absent = ports();
    delete absent.createProduct;
    expect((await createAdminHandler(absent)(request()))?.status).toBe(405);
    const broken = ports();
    broken.createProduct = vi.fn(async () => { throw new Error("secret database detail"); });
    const response = await createAdminHandler(broken)(request());
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("secret database detail");
  });

  it("maps only a known version conflict to 409", async () => {
    const adapter = ports();
    adapter.createProduct = vi.fn(async () => { throw new AdminProductMutationError("conflict"); });
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products`, {
      method: "POST", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    }));
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ error: "conflict" });
  });

  it("updates by a valid slug and expected timestamp with a current session", async () => {
    const adapter = ports();
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const body = { newSlug: "new-pump", expectedUpdatedAt: "2026-10-04T08:00:00Z", fields };
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/test-pump`, {
      method: "PUT", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }));
    expect(response?.status).toBe(200);
    expect(await response?.json()).toEqual({ id: "4d331dcf-4243-4a29-aacd-93c30af433e6", updatedAt: "2026-10-04T08:01:00Z" });
    expect(adapter.updateProduct).toHaveBeenCalledWith({ slug: "test-pump", ...body });
  });

  it("never updates for a guest, a foreign Origin, or a malformed URL slug", async () => {
    const adapter = ports();
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const body = JSON.stringify({ newSlug: "new-pump", expectedUpdatedAt: "2026-10-04T08:00:00Z", fields });
    for (const [path, headers, status] of [
      ["test-pump", { origin, "content-type": "application/json" }, 401],
      ["test-pump", { origin: "https://attacker.example", cookie: `admin_session=${token}`, "content-type": "application/json" }, 400],
      ["bad_slug", { origin, cookie: `admin_session=${token}`, "content-type": "application/json" }, 400],
    ] as const) {
      const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/${path}`, {
        method: "PUT", headers, body,
      }));
      expect(response?.status).toBe(status);
    }
    expect(adapter.updateProduct).not.toHaveBeenCalled();
  });

  it("returns a sanitized 409 for a stale edit", async () => {
    const adapter = ports();
    adapter.updateProduct = vi.fn(async () => { throw new AdminProductMutationError("conflict"); });
    const token = await createSessionCodec(secret, () => now).create({ credentialVersion: 1 });
    const response = await createAdminHandler(adapter)(new Request(`${origin}/api/admin/products/test-pump`, {
      method: "PUT", headers: { origin, cookie: `admin_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ newSlug: "new-pump", expectedUpdatedAt: "2026-10-04T08:00:00Z", fields }),
    }));
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({ error: "conflict" });
  });
});
