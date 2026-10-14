// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudflareWebAnalytics } from "@/components/analytics/CloudflareWebAnalytics";
import { webAnalyticsToken } from "@/lib/web-analytics";
import { serializeStaticHeaders } from "@/cloudflare/static-build/producer/headers";

const TOKEN = "0123456789abcdef0123456789abcdef";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe("webAnalyticsToken", () => {
  it("accepts only a 32-character lowercase hex token", () => {
    expect(webAnalyticsToken(TOKEN)).toBe(TOKEN);
    expect(webAnalyticsToken(` ${TOKEN}\n`)).toBe(TOKEN);
    for (const bad of [undefined, "", "abc", "0123456789ABCDEF0123456789ABCDEF", `${TOKEN}0`, `${TOKEN}"><script>`, "0123456789abcdef0123456789abcdeg"]) {
      expect(webAnalyticsToken(bad)).toBeNull();
    }
  });
});

describe("CloudflareWebAnalytics", () => {
  it("adds nothing to the page when no token is configured", () => {
    const { container } = render(<CloudflareWebAnalytics />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("adds nothing for a malformed token", () => {
    vi.stubEnv("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN", `${TOKEN}"><script>alert(1)</script>`);
    const { container } = render(<CloudflareWebAnalytics />);
    expect(container.querySelector("script")).toBeNull();
  });

  it("adds Cloudflare's script as a module (loaded after the page, as Cloudflare's own snippet does), with the site token", () => {
    vi.stubEnv("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN", TOKEN);
    const { container } = render(<CloudflareWebAnalytics />);
    const script = container.querySelector("script");
    expect(script?.getAttribute("src")).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(script?.getAttribute("type")).toBe("module");
    expect(JSON.parse(script?.getAttribute("data-cf-beacon") ?? "{}")).toEqual({ token: TOKEN });
  });
});

describe("static headers of the public site", () => {
  const base = { siteOrigin: "https://www.ayprom-gidravlika.kg", mediaOrigin: "https://media.ayprom-gidravlika.kg" };

  it("let the analytics script run only when the site is built with it", () => {
    expect(serializeStaticHeaders(base)).not.toContain("cloudflareinsights.com");
    const on = serializeStaticHeaders({ ...base, webAnalytics: true });
    expect(on).toContain("script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com");
    expect(on).toContain("https://cloudflareinsights.com");
  });
});
