import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { crawlRoutes } from "@/cloudflare/static-build/producer/crawl";
import type { CrawlSink } from "@/cloudflare/static-build/producer/types";
import type { RouteManifestEntry } from "@/cloudflare/static-build/route-manifest";

// In-process loopback server: lets the crawl contract be checked in isolation
// from the child-process runner (concurrency, abort, streaming body limit).
type Handler = (request: http.IncomingMessage, response: http.ServerResponse) => void;

let server: http.Server | null = null;

async function listen(handler: Handler): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

function pageEntries(count: number): RouteManifestEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    class: "static" as const,
    family: "brand" as const,
    path: `/catalog/brand/b${index}`,
    outputFile: `catalog/brand/b${index}.html`,
    expectedCanonical: `https://www.ayprom-gidravlika.kg/catalog/brand/b${index}`,
    expectedJsonLdTypes: [],
    expectedIndexable: true,
    snapshotIds: [`b${index}`],
  }));
}

function memorySink(): CrawlSink & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    write: async (outputFile, bytes) => {
      files.set(outputFile, bytes);
    },
  };
}

const limits = { concurrency: 3, requestTimeoutMs: 2_000, maxBodyBytes: 1_024, notFoundProbePath: "/missing-probe" };

describe("static producer crawl", () => {
  it("never exceeds the configured concurrency and uses all of it", async () => {
    let inFlight = 0;
    let peak = 0;
    const baseUrl = await listen((_request, response) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      setTimeout(() => {
        inFlight -= 1;
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html>");
      }, 60);
    });

    const result = await crawlRoutes({ baseUrl, entries: pageEntries(9), limits, sink: memorySink() });
    expect(result.failures).toEqual([]);
    expect(result.entries).toHaveLength(9);
    expect(peak).toBe(3);
  });

  it("aborts in-flight and pending requests when the shared signal fires", async () => {
    let requests = 0;
    const baseUrl = await listen((_request, response) => {
      requests += 1;
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html" });
        response.end("late");
      }, 5_000);
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    await expect(
      crawlRoutes({ baseUrl, entries: pageEntries(6), limits, sink: memorySink(), signal: controller.signal }),
    ).rejects.toMatchObject({ code: "crawl_failed", reason: "aborted" });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(requests).toBeLessThanOrEqual(3);
  });

  it("stops reading a streamed body once the limit is exceeded", async () => {
    let chunksSent = 0;
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      const timer = setInterval(() => {
        chunksSent += 1;
        response.write("y".repeat(512));
        if (chunksSent >= 200) {
          clearInterval(timer);
          response.end();
        }
      }, 5);
      response.on("close", () => clearInterval(timer));
    });
    const sink = memorySink();
    const result = await crawlRoutes({ baseUrl, entries: pageEntries(1), limits, sink });
    expect(result.failures).toEqual([
      { path: "/catalog/brand/b0", outputFile: "catalog/brand/b0.html", reason: "body_limit_exceeded" },
    ]);
    expect(sink.files.size).toBe(0);
    expect(chunksSent).toBeLessThan(200);
  });

  it("fetches the not-found probe for the /404 entry and expects a real 404", async () => {
    const seenPaths: string[] = [];
    const baseUrl = await listen((request, response) => {
      seenPaths.push(request.url ?? "");
      response.writeHead(request.url === "/missing-probe" ? 404 : 200, { "content-type": "text/html" });
      response.end("<!doctype html>");
    });
    const entries: RouteManifestEntry[] = [{
      class: "static", family: "not-found", path: "/404", outputFile: "404.html",
      expectedCanonical: null, expectedJsonLdTypes: [], expectedIndexable: false, snapshotIds: ["fixture"],
    }];
    const sink = memorySink();
    const result = await crawlRoutes({ baseUrl, entries, limits, sink });
    expect(seenPaths).toEqual(["/missing-probe"]);
    expect(result.entries[0]).toMatchObject({ path: "/404", outputFile: "404.html", status: 404, contentType: "text/html" });
    expect(sink.files.has("404.html")).toBe(true);
  });

  it("records a connection failure by error code only", async () => {
    const sink = memorySink();
    const result = await crawlRoutes({ baseUrl: "http://127.0.0.1:9", entries: pageEntries(1), limits, sink });
    expect(result.failures).toEqual([
      { path: "/catalog/brand/b0", outputFile: "catalog/brand/b0.html", reason: "request_failed", errorCode: expect.any(String) },
    ]);
    expect(JSON.stringify(result)).not.toContain("127.0.0.1:9");
  });
});
