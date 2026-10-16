import { describe, expect, it, vi } from "vitest";
import { requestRebuild } from "../scripts/cloudflare/publication-rebuild.mjs";

const URL_BASE = "https://acyoyvetcyqmwppfenau.supabase.co";
const KEY = "sb_secret_unit_test_value_0123456789";

function fakeFetch(handlers: { current?: unknown[]; patched?: unknown[]; status?: number; insertStatus?: number }) {
  const calls: { method: string; url: string; body?: string; headers: Record<string, string> }[] = [];
  const impl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ method, url, body: init.body as string | undefined, headers: init.headers as Record<string, string> });
    if (method === "GET") return new Response(JSON.stringify(handlers.current ?? []), { status: handlers.status ?? 200 });
    if (method === "PATCH") return new Response(JSON.stringify(handlers.patched ?? []), { status: handlers.status ?? 200 });
    return new Response("{}", { status: handlers.insertStatus ?? 201 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("requestRebuild (publish the site again although no content changed)", () => {
  it("raises the content revision by one, only if nobody changed it in between", async () => {
    const { impl, calls } = fakeFetch({ current: [{ current_revision: 46 }], patched: [{ current_revision: 47 }] });
    const result = await requestRebuild({ supabaseUrl: URL_BASE, secretKey: KEY, fetchImpl: impl, now: () => new Date("2026-10-16T08:00:00.000Z") });
    expect(result).toEqual({ bumped: true, from: 46, to: 47 });
    const patch = calls.find((call) => call.method === "PATCH")!;
    expect(patch.url).toBe(`${URL_BASE}/rest/v1/content_revision?singleton=eq.true&current_revision=eq.46`);
    expect(JSON.parse(patch.body!)).toEqual({ current_revision: 47, updated_at: "2026-10-16T08:00:00.000Z" });
  });

  it("is a no-op when someone else changed the revision in the meantime: a newer revision already asks for a publication", async () => {
    const { impl } = fakeFetch({ current: [{ current_revision: 46 }], patched: [] });
    expect(await requestRebuild({ supabaseUrl: URL_BASE, secretKey: KEY, fetchImpl: impl })).toEqual({ bumped: false, from: 46, to: 46 });
  });

  it("creates the revision row when the table is still empty", async () => {
    const { impl, calls } = fakeFetch({ current: [] });
    const result = await requestRebuild({ supabaseUrl: URL_BASE, secretKey: KEY, fetchImpl: impl, now: () => new Date("2026-10-16T08:00:00.000Z") });
    expect(result).toEqual({ bumped: true, from: 0, to: 1 });
    const insert = calls.find((call) => call.method === "POST")!;
    expect(insert.url).toBe(`${URL_BASE}/rest/v1/content_revision`);
    expect(JSON.parse(insert.body!)).toEqual({ singleton: true, current_revision: 1, updated_at: "2026-10-16T08:00:00.000Z" });
  });

  it("sends the key only as request headers and never puts it into an error message", async () => {
    const { impl } = fakeFetch({ current: [{ current_revision: 1 }], status: 500 });
    const failure = await requestRebuild({ supabaseUrl: URL_BASE, secretKey: KEY, fetchImpl: impl }).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toMatch(/500/);
    expect((failure as Error).message).not.toContain(KEY);
  });

  it("refuses a database address that is not https", async () => {
    const { impl } = fakeFetch({});
    await expect(requestRebuild({ supabaseUrl: "http://example.test", secretKey: KEY, fetchImpl: impl })).rejects.toThrow(/https/);
  });
});
