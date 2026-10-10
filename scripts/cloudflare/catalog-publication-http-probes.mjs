import assert from "node:assert/strict";

// Only the disposable-stack harness may use this test helper. No remote URLs.
export async function probeCatalogPublicationHttp(apiUrl, publicKey, activate, revoke) {
  assert.equal(apiUrl, "http://127.0.0.1:56421");
  assert.equal(typeof publicKey, "string");
  assert.ok(publicKey.length > 0);
  let checks = 0;
  const headers = { apikey: publicKey, "content-type": "application/json" };
  if (publicKey.startsWith("eyJ")) headers.authorization = `Bearer ${publicKey}`;
  const one = "10000000-0000-4000-8000-000000000001";
  const two = "10000000-0000-4000-8000-000000000002";
  async function request(path, body, extraHeaders = {}) {
    const response = await fetch(`${apiUrl}/rest/v1/${path}`, {
      method: body === undefined ? "GET" : "POST", headers: { ...headers, ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    console.log(JSON.stringify({ probe: path.split("?")[0], status: response.status }));
    for (const secret of [publicKey, "fixture-release-one", "fixture-release-two", "capability_hash"])
      assert.ok(!text.includes(secret), "response leaked private data");
    checks += 1;
    return { response, value: JSON.parse(text) };
  }
  async function denied(body) {
    const result = await request("rpc/read_catalog_publication_document", body);
    assert.equal(result.response.status, 500);
    assert.equal(result.value.code, "55000");
    assert.equal(result.value.message, "Catalog publication unavailable");
  }
  await denied({ kind: "product", key: "pump" });
  await activate();
  const active = await request("rpc/read_catalog_publication_document", { kind: "product", key: "pump" });
  assert.equal(active.response.status, 200);
  assert.deepEqual(active.value, { name: "Old pump" });
  const pinned = await request("rpc/read_catalog_publication_document", {
    kind: "product", key: "pump", publication_id: two, publication_capability: "fixture-release-two",
  });
  assert.equal(pinned.response.status, 200);
  assert.deepEqual(pinned.value, { name: "New pump" });
  for (const body of [
    { publication_id: two }, { publication_id: two, publication_capability: "fixture-release-one" },
    { publication_id: one },
    { publication_id: "10000000-0000-4000-8000-000000000099", publication_capability: "fixture-release-two" },
    { publication_capability: "fixture-release-one" },
  ]) await denied({ kind: "product", key: "pump", ...body });
  const documents = await request("rpc/list_catalog_publication_documents", { kind: "product" });
  assert.equal(documents.response.status, 200);
  assert.deepEqual(documents.value, [{ name: "Old pump" }]);
  const search = await request("rpc/search_catalog_products?offset=1&limit=1", {
    search_query: null, category_filter: null, subcategory_filter: null, brand_filter: null, vehicle_type_filter: null,
  }, { Prefer: "count=exact" });
  assert.ok([200, 206].includes(search.response.status));
  assert.equal(search.response.headers.get("content-range"), "1-1/3");
  assert.equal(search.value[0].slug, "old-a");
  assert.deepEqual(Object.keys(search.value[0]).sort(), [
    "slug", "name", "category_slug", "subcategory_slug", "short_description", "article",
    "cover_url", "cover_fallback_url", "cover_scale", "compatible_brands",
  ].sort());
  const outside = await request("rpc/search_catalog_products?offset=100&limit=24", {}, { Prefer: "count=exact" });
  assert.equal(outside.response.status, 416);
  assert.equal(outside.response.headers.get("content-range"), "*/3");
  const filtered = await request("rpc/search_catalog_products", {
    category_filter: "hydraulics", require_no_subcategory: true, vehicle_type_filter: "truck",
  });
  assert.equal(filtered.response.status, 200);
  assert.deepEqual(filtered.value.map((row) => row.slug), ["old-b"]);
  const candidate = await request("rpc/search_catalog_products", {
    publication_id: two, publication_capability: "fixture-release-two",
  });
  assert.equal(candidate.response.status, 200);
  assert.deepEqual(candidate.value.map((row) => row.slug), ["new-a"]);
  const rejected = await request("rpc/search_catalog_products", { publication_id: two });
  assert.equal(rejected.response.status, 500);
  assert.equal(rejected.value.code, "55000");
  const direct = await request("catalog_release_documents?select=*", undefined, { "Accept-Profile": "catalog_private" });
  assert.equal(direct.response.status, 406);
  const privateRpc = await request("rpc/resolve_publication", { publication_id: two });
  assert.equal(privateRpc.response.status, 404);
  for (const table of ["brands", "categories", "category_brands", "product_brands",
    "product_characteristics", "product_images", "product_vehicle_types", "products",
    "subcategories", "vehicle_hotspots", "vehicle_types"]) {
    const source = await request(`${table}?select=*&limit=1`);
    assert.ok([401, 403].includes(source.response.status), `${table} remained publicly readable`);
    assert.equal(source.value.code, "42501");
  }
  await revoke();
  await denied({ kind: "product", key: "pump", publication_id: two, publication_capability: "fixture-release-two" });
  return { ok: true, checks };
}
