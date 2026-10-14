import { assertAllowedUrl, normalizeSitemapUrl, requireWriteConfirmation } from "./policy.mjs";

const DIMENSIONS = new Set([
  "query",
  "page",
  "country",
  "device",
  "date",
  "searchAppearance",
  "hour",
]);
const OPERATORS = new Set([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "includingRegex",
  "excludingRegex",
]);

function validateDate(value, name) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value || "")
    ? new Date(`${value}T00:00:00Z`)
    : null;
  if (
    !parsed
    || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new Error(`${name} must use YYYY-MM-DD.`);
  }
}

function analyticsBody(input) {
  validateDate(input.startDate, "startDate");
  validateDate(input.endDate, "endDate");
  if (input.startDate > input.endDate) {
    throw new Error("startDate must not be later than endDate.");
  }

  const rowLimit = input.rowLimit ?? 1000;
  if (!Number.isInteger(rowLimit) || rowLimit < 1 || rowLimit > 25_000) {
    throw new Error("rowLimit must be an integer from 1 to 25000.");
  }
  const startRow = input.startRow ?? 0;
  if (!Number.isInteger(startRow) || startRow < 0) {
    throw new Error("startRow must be a non-negative integer.");
  }

  const dimensions = input.dimensions ?? [];
  for (const dimension of dimensions) {
    if (!DIMENSIONS.has(dimension)) {
      throw new Error(`Unsupported Search Console dimension: ${dimension}`);
    }
  }

  const body = {
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions,
    rowLimit,
  };
  if (startRow) body.startRow = startRow;
  if (input.type) body.type = input.type;
  if (input.dataState) body.dataState = input.dataState;

  if (input.filters?.length) {
    body.dimensionFilterGroups = [{
      groupType: "and",
      filters: input.filters.map((filter) => {
        if (!DIMENSIONS.has(filter.dimension)) {
          throw new Error(`Unsupported Search Console filter dimension: ${filter.dimension}`);
        }
        if (!OPERATORS.has(filter.operator)) {
          throw new Error(`Unsupported Search Console filter operator: ${filter.operator}`);
        }
        if (typeof filter.expression !== "string" || !filter.expression) {
          throw new Error("Search Console filter expression must be a non-empty string.");
        }
        return { ...filter };
      }),
    }];
  }
  return body;
}

function auditError(error) {
  return String(error?.message || error)
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

export function createToolHandlers({ client, config, authStatus, appendAudit }) {
  async function mutateSitemap(action, input, operation) {
    const sitemapUrl = requireWriteConfirmation(action, input.sitemapUrl, input.confirmation);
    const baseEvent = {
      action: action === "SUBMIT" ? "submit_sitemap" : "delete_sitemap",
      property: config.property,
      target: sitemapUrl,
    };

    await appendAudit({ ...baseEvent, outcome: "attempt" });
    try {
      await operation(sitemapUrl);
    } catch (error) {
      try {
        await appendAudit({ ...baseEvent, outcome: "failure", error: auditError(error) });
      } catch {
        // The pre-write attempt is already durable; preserve the Google API error.
      }
      throw error;
    }

    let auditWarning;
    try {
      await appendAudit({ ...baseEvent, outcome: "success" });
    } catch (error) {
      auditWarning = `Mutation succeeded, but outcome audit failed: ${auditError(error)}`;
    }
    return {
      property: config.property,
      sitemapUrl,
      status: action === "SUBMIT" ? "submitted" : "deleted",
      ...(auditWarning ? { auditWarning } : {}),
    };
  }

  return Object.freeze({
    authStatus: async () => authStatus(),
    propertyStatus: async () => client.propertyStatus(),
    searchAnalytics: async (input) => client.searchAnalytics(analyticsBody(input)),
    listSitemaps: async ({ sitemapIndex } = {}) => client.listSitemaps(
      sitemapIndex ? normalizeSitemapUrl(sitemapIndex) : undefined,
    ),
    getSitemap: async ({ sitemapUrl }) => client.getSitemap(normalizeSitemapUrl(sitemapUrl)),
    inspectUrl: async ({ url, languageCode = "ru-RU" }) => client.inspectUrl(
      assertAllowedUrl(url),
      languageCode,
    ),
    submitSitemap: async (input) => mutateSitemap(
      "SUBMIT",
      input,
      (url) => client.submitSitemap(url),
    ),
    deleteSitemap: async (input) => mutateSitemap(
      "DELETE",
      input,
      (url) => client.deleteSitemap(url),
    ),
  });
}
