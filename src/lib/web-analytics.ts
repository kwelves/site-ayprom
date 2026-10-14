// Cloudflare Web Analytics: the site token is public by design (it sits in the page for every visitor). Only a value
// that looks like one is ever used, so a malformed setting can never inject anything into a page.
const TOKEN_PATTERN = /^[a-f0-9]{32}$/;

export function webAnalyticsToken(value: string | undefined): string | null {
  const token = value?.trim();
  return token && TOKEN_PATTERN.test(token) ? token : null;
}
