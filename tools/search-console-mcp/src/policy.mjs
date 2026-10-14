import { PROPERTY } from "./config.mjs";

export const ALLOWED_PROPERTY = PROPERTY;
const ROOT_DOMAIN = "ayprom-gidravlika.kg";

export function assertAllowedUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("URL must be a valid absolute AYPROM URL.");
  }

  if (url.protocol !== "https:") {
    throw new Error("AYPROM URLs must use HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("AYPROM URLs must not contain credentials.");
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname !== ROOT_DOMAIN && !hostname.endsWith(`.${ROOT_DOMAIN}`)) {
    throw new Error("URL must belong to the AYPROM domain.");
  }

  return url.toString();
}

export function normalizeSitemapUrl(value) {
  const url = new URL(assertAllowedUrl(value));
  url.hash = "";
  return url.toString();
}

export function requireWriteConfirmation(action, sitemapUrl, confirmation) {
  if (action !== "SUBMIT" && action !== "DELETE") {
    throw new Error("Unsupported sitemap action.");
  }

  const normalizedUrl = normalizeSitemapUrl(sitemapUrl);
  const expected = `${action} ${normalizedUrl}`;
  if (confirmation !== expected) {
    throw new Error(`Invalid confirmation. Expected exactly: ${expected}`);
  }
  return normalizedUrl;
}
