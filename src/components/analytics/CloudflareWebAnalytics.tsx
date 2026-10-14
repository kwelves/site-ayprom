import { webAnalyticsToken } from "@/lib/web-analytics";

// Cloudflare Web Analytics: cookie-free page-view and speed statistics, in place of Vercel Speed Insights. The site
// token comes from the build; with none (or a malformed one) the page gets no script at all.
export function CloudflareWebAnalytics() {
  const token = webAnalyticsToken(process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN);
  if (!token) return null;
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token })}
    />
  );
}
