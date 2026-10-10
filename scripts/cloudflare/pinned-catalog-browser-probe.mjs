// Browser gate for one already-running, locally packaged pinned Worker.
// It never writes bindings, visits a remote origin, or returns response bodies.
import { chromium } from "playwright";

const EMPTY_QUERY = "ayprom-local-browser-no-match-7319";

export async function probePinnedCatalogBrowser({ baseUrl, query, expectedName, expectedSlug,
  productPath, sensitiveValue, timeoutMs = 15_000 }) {
  let browser;
  let stage = "preflight";
  try {
    const origin = new URL(baseUrl);
    if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1"
      || origin.pathname !== "/" || origin.search || origin.hash
      || typeof query !== "string" || !query.trim() || typeof expectedName !== "string" || !expectedName.trim()
      || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(expectedSlug ?? "")
      || !/^\/catalog\/[a-z0-9/-]+$/.test(productPath ?? "")
      || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 30_000) {
      throw new Error("invalid_probe_input");
    }
    stage = "browser_start";
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ serviceWorkers: "block" });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    page.setDefaultNavigationTimeout(timeoutMs);
    let pageErrors = 0;
    let localHttpErrors = 0;
    let leakedRequest = false;
    page.on("pageerror", () => { pageErrors += 1; });
    page.on("request", (request) => {
      if (sensitiveValue && request.url().includes(sensitiveValue)) leakedRequest = true;
    });
    page.on("response", (response) => {
      if (new URL(response.url()).origin === origin.origin && response.status() >= 400) localHttpErrors += 1;
    });
    await page.route("**/*", (route) => {
      try {
        return new URL(route.request().url()).origin === origin.origin ? route.continue() : route.abort();
      } catch {
        return route.abort();
      }
    });
    const apiResponseFor = (term) => page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === origin.origin && url.pathname === "/api/catalog/search"
        && url.searchParams.get("q") === term;
    }, { timeout: timeoutMs });
    const assertSearch = async (response, term, found) => {
      if (response.status() !== 200) throw new Error("search_status");
      const data = await response.json();
      if (sensitiveValue && JSON.stringify(data).includes(sensitiveValue)) throw new Error("response_leaked_binding");
      if (data.page !== 1 || !Array.isArray(data.items)) throw new Error("search_contract");
      const match = data.items.some((item) => item.slug === expectedSlug && item.name === expectedName);
      if (found !== match || (!found && data.items.length !== 0)) throw new Error(`search_result_${term}`);
    };

    stage = "catalog_open";
    const initial = await page.goto(`${origin.origin}/catalog`, { waitUntil: "networkidle" });
    if (initial?.status() !== 200) throw new Error("catalog_status");
    stage = "search";
    const input = page.getByRole("textbox", { name: "Поиск по каталогу", exact: true });
    await input.fill(query);
    const [search] = await Promise.all([apiResponseFor(query), input.press("Enter")]);
    await assertSearch(search, query, true);
    if (new URL(page.url()).searchParams.get("q") !== query) throw new Error("search_url");
    const productLink = page.getByRole("link", { name: expectedName, exact: true }).first();
    await productLink.waitFor();
    if (new URL(await productLink.getAttribute("href"), origin.origin).pathname !== productPath) {
      throw new Error("product_href");
    }
    stage = "product_click";
    // ProductCard's photo sits above its stretched link and handles taps.
    // Click what a visitor can actually click, not the covered anchor.
    const photo = productLink.locator("..").getByRole("img").first();
    if (await photo.count()) await photo.click();
    // force: when a photo is briefly absent (retrying a dropped connection) the card still handles the tap.
    else await productLink.click({ force: true });
    stage = "product_url";
    await page.waitForURL((url) => url.pathname === productPath, { timeout: timeoutMs });
    stage = "product_heading";
    await page.getByRole("heading", { level: 1, name: expectedName, exact: true }).waitFor();

    stage = "reload";
    const [reloadSearch, reloaded] = await Promise.all([apiResponseFor(query),
      page.goto(`${origin.origin}/catalog?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded" })]);
    if (reloaded?.status() !== 200) throw new Error("reload_status");
    await assertSearch(reloadSearch, query, true);
    await page.getByRole("link", { name: expectedName, exact: true }).first().waitFor();

    stage = "empty";
    const [emptySearch, empty] = await Promise.all([apiResponseFor(EMPTY_QUERY),
      page.goto(`${origin.origin}/catalog?q=${EMPTY_QUERY}`, { waitUntil: "domcontentloaded" })]);
    if (empty?.status() !== 200) throw new Error("empty_status");
    await assertSearch(emptySearch, EMPTY_QUERY, false);
    await page.getByText("Ничего не найдено", { exact: true }).waitFor();
    if (pageErrors !== 0 || localHttpErrors !== 0 || leakedRequest) throw new Error("browser_runtime_error");
    return { ok: true, checks: ["search", "reload", "product", "empty"],
      pageErrors, localHttpErrors, leakedRequest: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const reason = ["product_href", "search_url", "browser_runtime_error", "catalog_status",
      "reload_status", "empty_status", "search_status", "search_contract", "response_leaked_binding"].includes(message)
      ? message : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "other";
    throw new Error(`pinned_browser_probe_failed:${stage}:${reason}`);
  } finally {
    await browser?.close();
  }
}
