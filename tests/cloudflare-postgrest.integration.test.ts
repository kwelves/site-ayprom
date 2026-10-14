import { describe, expect, it } from "vitest";
import { createCloudflareWorkerApi } from "@/cloudflare/worker-api";
import { createPublicCatalogSearchRpc } from "@/cloudflare/supabase-catalog-search";
import { executeCatalogSearch } from "@/lib/catalog-search-contract";
import {
  assertLocalSupabaseUrl,
  assertPublicSupabaseKey,
} from "../scripts/cloudflare/postgrest-contract-lib.mjs";

const contractEnabled = process.env.CLOUDFLARE_POSTGREST_CONTRACT === "1";
const describeContract = contractEnabled ? describe : describe.skip;

describeContract("тонкий Worker против настоящего local PostgREST", () => {
  const supabaseUrl = requiredEnv("CLOUDFLARE_POSTGREST_URL");
  const publishableKey = requiredEnv(
    "CLOUDFLARE_POSTGREST_PUBLISHABLE_KEY",
  );
  if (contractEnabled) {
    assertLocalSupabaseUrl(supabaseUrl);
    assertPublicSupabaseKey(publishableKey);
  }
  const searchRpc = createPublicCatalogSearchRpc({
    SUPABASE_URL: supabaseUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
  });

  it("реально ограничивает первую страницу через POST offset/limit", async () => {
    const page = await executeCatalogSearch(
      { page: 1, pageSize: 5 },
      searchRpc,
    );

    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(5);
    expect(page.total).toBeGreaterThan(5);
    expect(page.items).toHaveLength(5);
  });

  it("преобразует реальный PGRST103 за пределами total в ProductPage", async () => {
    const handleRequest = createCloudflareWorkerApi({ searchRpc });
    const response = await handleRequest(
      new Request("http://worker.local/api/catalog/search?page=100000"),
    );
    const page = await response.json();

    expect(response.status).toBe(200);
    expect(page).toMatchObject({
      items: [],
      page: 100000,
      pageSize: 24,
    });
    expect(page.total).toBeGreaterThan(0);
    expect(page.totalPages).toBe(Math.ceil(page.total / 24));
  });

  it("сохраняет запрошенную страницу при нулевом exact count", async () => {
    const handleRequest = createCloudflareWorkerApi({ searchRpc });
    const response = await handleRequest(
      new Request(
        "http://worker.local/api/catalog/search?q=zzzxxyy_postgrest_contract_no_match&page=3",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      items: [],
      total: 0,
      page: 3,
      pageSize: 24,
      totalPages: 1,
    });
  });

  // Schema-first: проходит только после миграции
  // *_mixed_category_no_subcategory_search. На старой схеме PostgREST отвечает
  // PGRST202, и Worker честно возвращает 502 вместо расширенной выборки.
  it("режим noSubcategory=1 считает только товары без подкатегории", async () => {
    const handleRequest = createCloudflareWorkerApi({ searchRpc });
    const [directResponse, allResponse] = await Promise.all([
      handleRequest(new Request("http://worker.local/api/catalog/search?noSubcategory=1")),
      handleRequest(new Request("http://worker.local/api/catalog/search")),
    ]);
    const direct = await directResponse.json();
    const all = await allResponse.json();

    expect(directResponse.status).toBe(200);
    expect(direct.total).toBeLessThanOrEqual(all.total);
    expect(direct.items.every((item: { subcategory?: string }) => item.subcategory === undefined)).toBe(true);
  });
});

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value && contractEnabled) {
    throw new Error(`${name} не задан локальным contract runner.`);
  }
  return value ?? "";
}
