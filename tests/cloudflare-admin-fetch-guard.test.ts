import { describe, expect, it } from "vitest";
import { createGuardedFetch } from "@/cloudflare/admin-worker/fetch-guard";

const DB = "https://db.example.test/rest/v1/products?select=id";
const hangUntilAborted: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new Error("aborted"))));

describe("database fetch guard", () => {
  it("cuts a hanging read and answers from the second try", async () => {
    let calls = 0;
    const guarded = createGuardedFetch(
      (input, init) => (++calls === 1 ? hangUntilAborted(input, init) : Promise.resolve(new Response("ok"))),
      { readTimeoutMs: 20, writeTimeoutMs: 200 },
    );
    const response = await guarded(DB);
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
  });

  it("gives up after the second hanging read", async () => {
    let calls = 0;
    const guarded = createGuardedFetch((input, init) => (calls++, hangUntilAborted(input, init)), { readTimeoutMs: 15 });
    await expect(guarded(DB)).rejects.toBeDefined();
    expect(calls).toBe(2);
  });

  it("never repeats a write, but does not let it hang forever", async () => {
    let calls = 0;
    const guarded = createGuardedFetch((input, init) => (calls++, hangUntilAborted(input, init)), { readTimeoutMs: 10, writeTimeoutMs: 30 });
    await expect(guarded(DB, { method: "POST", body: "{}" })).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  it("passes other addresses (file storage, other hosts) through untouched", async () => {
    const seen: Array<AbortSignal | null | undefined> = [];
    const guarded = createGuardedFetch((_input, init) => (seen.push(init?.signal), Promise.resolve(new Response("x"))), { readTimeoutMs: 5 });
    await guarded("https://db.example.test/storage/v1/object/a");
    expect(seen).toEqual([undefined]);
  });

  it("does not repeat a read the caller itself cancelled", async () => {
    let calls = 0;
    const controller = new AbortController();
    const guarded = createGuardedFetch((input, init) => (calls++, hangUntilAborted(input, init)), { readTimeoutMs: 1000 });
    const pending = guarded(DB, { signal: controller.signal });
    controller.abort(new Error("stop"));
    await expect(pending).rejects.toThrow("stop");
    expect(calls).toBe(1);
  });

  it("returns an error status from the database as is, without a second try", async () => {
    let calls = 0;
    const guarded = createGuardedFetch(() => (calls++, Promise.resolve(new Response("denied", { status: 403 }))));
    expect((await guarded(DB)).status).toBe(403);
    expect(calls).toBe(1);
  });
});
