import { loadOAuthClient, loadToken, saveToken } from "./oauth-store.mjs";

const WEBMASTERS_BASE = "https://www.googleapis.com/webmasters/v3";
const INSPECTION_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

function safeErrorMessage(status, payload) {
  const apiMessage = payload?.error?.message || payload?.message;
  return `Google Search Console API ${status}${apiMessage ? `: ${apiMessage}` : ""}`;
}

export function createSearchConsoleClient({
  config,
  fetchImpl = globalThis.fetch,
  now = Date.now,
}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  let cachedToken;

  async function accessToken() {
    cachedToken ||= await loadToken(config);
    if (
      cachedToken.access_token
      && Number(cachedToken.expiry_date) > now() + 60_000
    ) {
      return cachedToken.access_token;
    }
    if (!cachedToken.refresh_token) {
      throw new Error("Stored OAuth token has no refresh_token. Run npm run auth again.");
    }

    const oauthClient = await loadOAuthClient(config);
    const body = new URLSearchParams({
      client_id: oauthClient.clientId,
      client_secret: oauthClient.clientSecret,
      refresh_token: cachedToken.refresh_token,
      grant_type: "refresh_token",
    });
    const response = await fetchImpl(oauthClient.tokenUri, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(safeErrorMessage(response.status, payload));
    }

    cachedToken = {
      ...cachedToken,
      ...payload,
      refresh_token: cachedToken.refresh_token,
      expiry_date: now() + Number(payload.expires_in || 3600) * 1000,
    };
    await saveToken(config, cachedToken);
    return cachedToken.access_token;
  }

  async function request(url, { method = "GET", body } = {}) {
    const token = await accessToken();
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) {
      return {};
    }

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = {};
      }
    }
    if (!response.ok) {
      throw new Error(safeErrorMessage(response.status, payload));
    }
    return payload;
  }

  const encodedProperty = encodeURIComponent(config.property);
  const propertyBase = `${WEBMASTERS_BASE}/sites/${encodedProperty}`;

  return Object.freeze({
    propertyStatus: () => request(propertyBase),
    searchAnalytics: (query) => request(`${propertyBase}/searchAnalytics/query`, {
      method: "POST",
      body: query,
    }),
    listSitemaps: (sitemapIndex) => {
      const url = new URL(`${propertyBase}/sitemaps`);
      if (sitemapIndex) url.searchParams.set("sitemapIndex", sitemapIndex);
      return request(url.toString());
    },
    getSitemap: (sitemapUrl) => request(
      `${propertyBase}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    ),
    submitSitemap: (sitemapUrl) => request(
      `${propertyBase}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      { method: "PUT" },
    ),
    deleteSitemap: (sitemapUrl) => request(
      `${propertyBase}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
      { method: "DELETE" },
    ),
    inspectUrl: (inspectionUrl, languageCode = "ru-RU") => request(INSPECTION_URL, {
      method: "POST",
      body: {
        inspectionUrl,
        siteUrl: config.property,
        languageCode,
      },
    }),
  });
}
