import { expect, it } from "vitest";
import { requestAdminJson } from "@/cloudflare/admin/json-request";

const url = new URL("http://127.0.0.1:55421/rest/v1/test");
it("decodes split UTF-8 chunks and preserves the status without exposing Response", async () => {
  const bytes = new TextEncoder().encode('{"text":"Товар 😀"}');
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  expect(await requestAdminJson(url, {}, async () => new Response(body))).toEqual({ status: 200, ok: true, payload: { text: "Товар 😀" } });
});
it("limits bytes, not decoded characters", async () => {
  expect(await requestAdminJson(url, {}, async () => new Response('"é"'), { maxBytes: 4 })).toMatchObject({ payload: "é" });
  await expect(requestAdminJson(url, {}, async () => new Response('"é"'), { maxBytes: 3 })).rejects.toThrow("Admin backend unavailable");
});
it("times out a fetch even if the injected fetcher ignores the signal", async () => {
  await expect(requestAdminJson(url, {}, async () => new Promise<Response>(() => {}), { timeoutMs: 25 })).rejects.toThrow("Admin backend unavailable");
});
it("cancels a response that arrives after the deadline", async () => {
  let resolveResponse!: (response: Response) => void;
  let cancelled = false;
  const pending = new Promise<Response>((resolve) => { resolveResponse = resolve; });
  await expect(requestAdminJson(url, {}, async () => pending, { timeoutMs: 25 })).rejects.toThrow("Admin backend unavailable");
  resolveResponse(new Response(new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } })));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(cancelled).toBe(true);
});
it("times out and cancels an unfinished response body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"secret":"')); },
    cancel() { cancelled = true; },
  });
  await expect(requestAdminJson(url, {}, async () => new Response(body), { timeoutMs: 25 })).rejects.toThrow("Admin backend unavailable");
  expect(cancelled).toBe(true);
});
it("parses Auth 400 only when explicitly allowed, but never accepts redirects", async () => {
  const wrong = () => Response.json({ code: "invalid_credentials" }, { status: 400 });
  await expect(requestAdminJson(url, {}, async () => wrong())).rejects.toThrow("Admin backend unavailable");
  expect(await requestAdminJson(url, {}, async () => wrong(), { acceptedStatuses: [400] })).toMatchObject({ status: 400, ok: false });
  await expect(requestAdminJson(url, {}, async () => Response.json({}, { status: 302 }), { acceptedStatuses: [302] })).rejects.toThrow("Admin backend unavailable");
});
it("sanitizes network and invalid-JSON errors, and rejects invalid limits before I/O", async () => {
  await expect(requestAdminJson(url, {}, async () => { throw new Error("never-report-this-secret"); })).rejects.toThrow("Admin backend unavailable");
  await expect(requestAdminJson(url, {}, async () => new Response("never-report-this-secret"))).rejects.toThrow("Admin backend unavailable");
  let calls = 0;
  await expect(requestAdminJson(url, {}, async () => { calls++; return Response.json({}); }, { maxBytes: 0 })).rejects.toThrow("Admin backend unavailable");
  expect(calls).toBe(0);
});
