import { describe, expect, it, vi } from "vitest";
import { describePublicationStatus } from "@/lib/publication/status";
import { isPublicationEnabled, requestPublicationWorker } from "@/lib/photo-queue/enqueue";
import { runInBackground, runWithBackground } from "@/lib/background-tasks";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const base = { currentRevision: 10, deployedRevision: 10, leaseUntil: null, attemptCount: 0, lastErrorCode: null };

describe("describePublicationStatus", () => {
  it("is published when the site already shows the latest revision", () => {
    expect(describePublicationStatus(base, NOW)).toEqual({ state: "published", behind: 0, lastErrorCode: null });
    expect(describePublicationStatus({ ...base, deployedRevision: 12 }, NOW).state).toBe("published");
  });

  it("is waiting when edits are newer than the published site and nobody is building", () => {
    expect(describePublicationStatus({ ...base, currentRevision: 14 }, NOW)).toEqual({ state: "pending", behind: 4, lastErrorCode: null });
  });

  it("is publishing while a build holds a live lease, and waiting again when the lease ran out", () => {
    const leased = { ...base, currentRevision: 11, leaseUntil: new Date(NOW + 60_000).toISOString() };
    expect(describePublicationStatus(leased, NOW).state).toBe("publishing");
    expect(describePublicationStatus({ ...leased, leaseUntil: new Date(NOW - 1000).toISOString() }, NOW).state).toBe("pending");
  });

  it("is failed after three attempts with an error, and still waiting after fewer", () => {
    const failing = { ...base, currentRevision: 11, attemptCount: 3, lastErrorCode: "build_failed" };
    expect(describePublicationStatus(failing, NOW)).toEqual({ state: "failed", behind: 1, lastErrorCode: "build_failed" });
    expect(describePublicationStatus({ ...failing, attemptCount: 1 }, NOW).state).toBe("pending");
  });
});

describe("publication trigger configuration", () => {
  const env = { GITHUB_DISPATCH_TOKEN: "ghp_test_token_value", GITHUB_REPOSITORY: "kwelves/site-ayprom", PUBLICATION_WORKFLOW_FILE: "publish-site.yml", PUBLICATION_WORKFLOW_REF: "main" };

  it("is enabled only when a publication workflow is configured", () => {
    expect(isPublicationEnabled(env)).toBe(true);
    expect(isPublicationEnabled({ ...env, PUBLICATION_WORKFLOW_FILE: "" })).toBe(false);
    expect(isPublicationEnabled({})).toBe(false);
  });

  it("starts the publication workflow on GitHub and never throws", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await requestPublicationWorker(env, fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/kwelves/site-ayprom/actions/workflows/publish-site.yml/dispatches");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "main" });
    const down = vi.fn(async () => { throw new TypeError("offline"); });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await requestPublicationWorker(env, down as unknown as typeof fetch)).toBe(false);
    quiet.mockRestore();
    expect(await requestPublicationWorker({}, fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});

describe("background tasks", () => {
  it("hands the work to the request's own waitUntil when there is one", async () => {
    const handed: Promise<unknown>[] = [];
    let ran = false;
    await runWithBackground((promise) => { handed.push(promise); }, async () => {
      runInBackground(Promise.resolve().then(() => { ran = true; }));
    });
    expect(handed).toHaveLength(1);
    await handed[0];
    expect(ran).toBe(true);
  });

  it("still runs the work (and swallows its failure) when nobody supplied a scheduler", async () => {
    let ran = false;
    runInBackground(Promise.resolve().then(() => { ran = true; }));
    runInBackground(Promise.reject(new Error("boom")));
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(ran).toBe(true);
  });
});
