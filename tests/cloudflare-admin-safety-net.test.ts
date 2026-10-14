import { describe, expect, it, vi } from "vitest";
import { runSafetyNet } from "@/cloudflare/admin-worker/safety-net";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const env = { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co", SUPABASE_SECRET_KEY: "secret-key-for-tests-only-0123456789" };

interface State {
  revision?: { current_revision: number; updated_at: string } | null;
  job?: { deployed_revision: number; lease_until: string | null; attempt_count: number } | null;
  queuedPhotos?: unknown[];
  fail?: "revision" | "photos";
}

function fakeDatabase(state: State) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    expect(new Headers(init?.headers).get("apikey")).toBe(env.SUPABASE_SECRET_KEY);
    if (url.includes("/content_revision")) {
      if (state.fail === "revision") return new Response("boom", { status: 500 });
      return Response.json(state.revision ? [state.revision] : []);
    }
    if (url.includes("/publication_jobs")) return Response.json(state.job ? [state.job] : []);
    if (url.includes("/product_image_staging")) {
      if (state.fail === "photos") return new Response("boom", { status: 500 });
      return Response.json(state.queuedPhotos ?? []);
    }
    return new Response("unexpected", { status: 404 });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const wakers = () => ({ publication: vi.fn(async () => true), photo: vi.fn(async () => true) });

describe("safety net (scheduled check of the publication and the photo queue)", () => {
  it("wakes the publication worker when edits have waited for more than 5 minutes and nobody is working on them", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 12, updated_at: minutesAgo(9) }, job: { deployed_revision: 10, lease_until: null, attempt_count: 0 } });
    const report = await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake });
    expect(wake.publication).toHaveBeenCalledTimes(1);
    expect(report.publication).toBe("woken");
  });

  it("leaves a fresh edit alone: the normal start has not had its time yet", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 12, updated_at: minutesAgo(2) }, job: { deployed_revision: 10, lease_until: null, attempt_count: 0 } });
    expect((await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake })).publication).toBe("waiting");
    expect(wake.publication).not.toHaveBeenCalled();
  });

  it("does nothing when the site is up to date", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 10, updated_at: minutesAgo(90) }, job: { deployed_revision: 10, lease_until: null, attempt_count: 0 } });
    expect((await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake })).publication).toBe("up_to_date");
    expect(wake.publication).not.toHaveBeenCalled();
  });

  it("does not wake a second worker while one holds a valid lease", async () => {
    const wake = wakers();
    const lease = new Date(NOW + 10 * 60_000).toISOString();
    const db = fakeDatabase({ revision: { current_revision: 12, updated_at: minutesAgo(20) }, job: { deployed_revision: 10, lease_until: lease, attempt_count: 1 } });
    expect((await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake })).publication).toBe("in_progress");
    expect(wake.publication).not.toHaveBeenCalled();
  });

  it("wakes the worker when the lease of a crashed one has expired", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 12, updated_at: minutesAgo(30) }, job: { deployed_revision: 10, lease_until: minutesAgo(10), attempt_count: 1 } });
    expect((await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake })).publication).toBe("woken");
  });

  it("stops after the failed attempts are used up: a person must press retry, a timer must not spin forever", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 12, updated_at: minutesAgo(60) }, job: { deployed_revision: 10, lease_until: null, attempt_count: 3 } });
    expect((await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake })).publication).toBe("needs_a_person");
    expect(wake.publication).not.toHaveBeenCalled();
  });

  it("wakes the photo worker for photos that have waited for more than 10 minutes", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: { current_revision: 10, updated_at: minutesAgo(90) }, job: { deployed_revision: 10, lease_until: null, attempt_count: 0 }, queuedPhotos: [{ id: "x" }] });
    const report = await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake });
    expect(wake.photo).toHaveBeenCalledTimes(1);
    expect(report.photos).toBe("woken");
    const photoQuery = decodeURIComponent(db.calls.find((url) => url.includes("/product_image_staging")) ?? "");
    expect(photoQuery).toContain(`queued_at=lt.${minutesAgo(10)}`);
    expect(photoQuery).toContain("finalized_at=is.null");
    expect(photoQuery).toContain("failed_at=is.null");
  });

  it("does not wake the photo worker when nothing is waiting", async () => {
    const wake = wakers();
    const db = fakeDatabase({ revision: null, job: null, queuedPhotos: [] });
    const report = await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake });
    expect(report.photos).toBe("idle");
    expect(wake.photo).not.toHaveBeenCalled();
  });

  it("never throws: a database or GitHub failure is reported and the other check still runs", async () => {
    const wake = wakers();
    wake.photo = vi.fn(async () => { throw new Error("github down ghp_secret"); });
    const db = fakeDatabase({ fail: "revision", queuedPhotos: [{ id: "x" }] });
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.join(" ")); });
    const report = await runSafetyNet(env, { now: () => NOW, fetchImpl: db.fetchImpl, wake });
    spy.mockRestore();
    expect(report.publication).toBe("check_failed");
    expect(report.photos).toBe("check_failed");
    expect(logged.join(" ")).not.toMatch(/ghp_secret|secret-key-for-tests/);
  });

  it("does nothing when the database is not configured", async () => {
    const wake = wakers();
    const report = await runSafetyNet({}, { now: () => NOW, fetchImpl: vi.fn() as unknown as typeof fetch, wake });
    expect(report).toEqual({ publication: "not_configured", photos: "not_configured" });
    expect(wake.publication).not.toHaveBeenCalled();
  });
});
