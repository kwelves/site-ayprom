import assert from "node:assert/strict";
import test from "node:test";

import { createToolHandlers } from "../src/tool-handlers.mjs";

function setup(overrides = {}) {
  const calls = [];
  const audits = [];
  const client = {
    propertyStatus: async () => ({ permissionLevel: "siteOwner" }),
    searchAnalytics: async (body) => {
      calls.push(["searchAnalytics", body]);
      return { rows: [] };
    },
    listSitemaps: async (index) => {
      calls.push(["listSitemaps", index]);
      return { sitemap: [] };
    },
    getSitemap: async (url) => {
      calls.push(["getSitemap", url]);
      return { path: url };
    },
    inspectUrl: async (url, languageCode) => {
      calls.push(["inspectUrl", url, languageCode]);
      return { inspectionResult: { inspectionResultLink: "https://search.google.com/" } };
    },
    submitSitemap: async (url) => {
      calls.push(["submitSitemap", url]);
      return {};
    },
    deleteSitemap: async (url) => {
      calls.push(["deleteSitemap", url]);
      return {};
    },
    ...overrides,
  };
  const handlers = createToolHandlers({
    client,
    config: { property: "sc-domain:ayprom-gidravlika.kg" },
    authStatus: async () => ({ authenticated: true }),
    appendAudit: async (event) => audits.push(event),
  });
  return { handlers, calls, audits };
}

test("searchAnalytics validates dates and passes supported filters", async () => {
  const { handlers, calls } = setup();
  const result = await handlers.searchAnalytics({
    startDate: "2026-06-01",
    endDate: "2026-09-01",
    dimensions: ["query", "page"],
    rowLimit: 500,
    filters: [{ dimension: "country", operator: "equals", expression: "kgz" }],
  });

  assert.deepEqual(result, { rows: [] });
  assert.deepEqual(calls[0], ["searchAnalytics", {
    startDate: "2026-06-01",
    endDate: "2026-09-01",
    dimensions: ["query", "page"],
    rowLimit: 500,
    dimensionFilterGroups: [{
      groupType: "and",
      filters: [{ dimension: "country", operator: "equals", expression: "kgz" }],
    }],
  }]);
});

test("searchAnalytics rejects reversed dates and excessive rows before API access", async () => {
  const { handlers, calls } = setup();
  await assert.rejects(
    () => handlers.searchAnalytics({ startDate: "2026-02-31", endDate: "2026-03-01" }),
    /startDate/i,
  );
  await assert.rejects(
    () => handlers.searchAnalytics({ startDate: "2026-09-01", endDate: "2026-06-01" }),
    /startDate/i,
  );
  await assert.rejects(
    () => handlers.searchAnalytics({ startDate: "2026-06-01", endDate: "2026-09-01", rowLimit: 25_001 }),
    /rowLimit/i,
  );
  assert.equal(calls.length, 0);
});

test("URL inspection rejects non-AYPROM URLs before API access", async () => {
  const { handlers, calls } = setup();
  await assert.rejects(() => handlers.inspectUrl({ url: "https://example.com/" }), /AYPROM/i);
  assert.equal(calls.length, 0);
});

test("sitemap reads normalize and pass only AYPROM URLs", async () => {
  const { handlers, calls } = setup();
  const url = "https://www.ayprom-gidravlika.kg/sitemap.xml#fragment";
  await handlers.getSitemap({ sitemapUrl: url });
  assert.deepEqual(calls[0], ["getSitemap", "https://www.ayprom-gidravlika.kg/sitemap.xml"]);
});

test("submit sitemap requires confirmation and audits before API mutation", async () => {
  const order = [];
  const url = "https://www.ayprom-gidravlika.kg/sitemap.xml";
  const { handlers, calls, audits } = setup({
    submitSitemap: async (value) => {
      order.push("api");
      calls.push(["submitSitemap", value]);
      return {};
    },
  });
  await assert.rejects(
    () => handlers.submitSitemap({ sitemapUrl: url, confirmation: "yes" }),
    /confirmation/i,
  );
  assert.equal(calls.length, 0);

  const tracked = createToolHandlers({
    client: {
      submitSitemap: async () => {
        order.push("api");
        return {};
      },
    },
    config: { property: "sc-domain:ayprom-gidravlika.kg" },
    authStatus: async () => ({ authenticated: true }),
    appendAudit: async (event) => {
      order.push(`audit:${event.outcome}`);
      audits.push(event);
    },
  });
  await tracked.submitSitemap({ sitemapUrl: url, confirmation: `SUBMIT ${url}` });

  assert.deepEqual(order, ["audit:attempt", "api", "audit:success"]);
  assert.equal(audits[0].property, "sc-domain:ayprom-gidravlika.kg");
  assert.equal(audits[0].target, url);
});

test("audit failure blocks a sitemap mutation", async () => {
  let called = false;
  const url = "https://www.ayprom-gidravlika.kg/sitemap.xml";
  const handlers = createToolHandlers({
    client: { deleteSitemap: async () => { called = true; } },
    config: { property: "sc-domain:ayprom-gidravlika.kg" },
    authStatus: async () => ({ authenticated: true }),
    appendAudit: async () => { throw new Error("disk full"); },
  });

  await assert.rejects(
    () => handlers.deleteSitemap({ sitemapUrl: url, confirmation: `DELETE ${url}` }),
    /disk full/i,
  );
  assert.equal(called, false);
});

test("failed Google mutation is followed by a failure audit", async () => {
  const url = "https://www.ayprom-gidravlika.kg/sitemap.xml";
  const { handlers, audits } = setup({
    deleteSitemap: async () => { throw new Error("Google unavailable"); },
  });

  await assert.rejects(
    () => handlers.deleteSitemap({ sitemapUrl: url, confirmation: `DELETE ${url}` }),
    /Google unavailable/,
  );
  assert.deepEqual(audits.map((entry) => entry.outcome), ["attempt", "failure"]);
  assert.equal(audits[1].error, "Google unavailable");
});
