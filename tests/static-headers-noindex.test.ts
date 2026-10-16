import { describe, expect, it } from "vitest";
import { serializeStaticHeaders } from "@/cloudflare/static-build/producer/headers";

const base = { siteOrigin: "https://www.ayprom-gidravlika.kg", mediaOrigin: "https://media.ayprom-gidravlika.kg" };

describe("search engines and the technical addresses of the public site", () => {
  const headers = serializeStaticHeaders(base);

  it("are told not to index the workers.dev address (it also covers per-version addresses), which is only for checks", () => {
    expect(headers).toContain("https://:worker.:subdomain.workers.dev/*\n  X-Robots-Tag: noindex\n");
  });

  it("are never told that about the real site address", () => {
    expect(headers).not.toContain("ayprom-gidravlika.kg/*");
    expect(headers.split("\n").filter((line) => line.startsWith("/*"))).toHaveLength(1);
    // The general rule for every address must not carry the noindex header.
    const general = headers.slice(headers.indexOf("/*\n"), headers.indexOf("\n\n"));
    expect(general).not.toContain("X-Robots-Tag");
  });
});
