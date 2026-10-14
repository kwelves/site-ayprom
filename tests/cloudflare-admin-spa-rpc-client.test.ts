import { describe, expect, it, vi } from "vitest";
import { AdminNotFoundError, createRpcClient, encodeRpcArgs } from "@/cloudflare/admin-spa/rpc-client";

interface Harness {
  client: ReturnType<typeof createRpcClient>;
  calls: Array<{ url: string; body: { args: unknown[] } }>;
  navigate: ReturnType<typeof vi.fn>;
  onUnauthorized: ReturnType<typeof vi.fn>;
  clock: { now: number };
}

function harness(answer: (name: string, args: unknown[]) => Response | Promise<Response>): Harness {
  const calls: Harness["calls"] = [];
  const navigate = vi.fn();
  const onUnauthorized = vi.fn();
  const clock = { now: 1_000_000 };
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { args: unknown[] };
    calls.push({ url, body });
    return answer(url.split("/").pop() as string, body.args);
  }) as unknown as typeof fetch;
  const client = createRpcClient({ fetchImpl, navigate, onUnauthorized, now: () => clock.now, backgroundRefreshAfterMs: 3000 });
  return { client, calls, navigate, onUnauthorized, clock };
}

const ok = (value: unknown) => new Response(JSON.stringify({ ok: true, value }), { status: 200 });

describe("encodeRpcArgs", () => {
  it("turns FormData and undefined into tagged JSON the Worker understands", async () => {
    const form = new FormData();
    form.append("a", "1");
    form.append("a", "2");
    expect(await encodeRpcArgs([undefined, form, { keep: 1, drop: undefined, nested: [undefined] }])).toEqual([
      { $undefined: true },
      { $formData: [["a", "1"], ["a", "2"]] },
      { keep: 1, drop: { $undefined: true }, nested: [{ $undefined: true }] },
    ]);
  });

  it("carries files (also the empty one of an untouched file input) as base64 so the Worker can rebuild them", async () => {
    const form = new FormData();
    form.append("logo", new File(["hi"], "logo.png", { type: "image/png" }));
    form.append("spare", new File([], ""));
    expect(await encodeRpcArgs([form])).toEqual([
      { $formData: [
        ["logo", { $file: { name: "logo.png", type: "image/png", base64: "aGk=" } }],
        ["spare", { $file: { name: "", type: "application/octet-stream", base64: "" } }],
      ] },
    ]);
  });
});

describe("rpc client call", () => {
  it("posts JSON to the action URL and returns the value", async () => {
    const h = harness(() => ok({ id: 7 }));
    await expect(h.client.call("createBrand", ["x"])).resolves.toEqual({ id: 7 });
    expect(h.calls[0].url).toBe("/api/admin/rpc/createBrand");
    expect(h.calls[0].body.args).toEqual(["x"]);
  });

  it("follows a redirect answer by navigating and resolves to undefined", async () => {
    const h = harness(() => new Response(JSON.stringify({ ok: true, redirect: "/admin/brands?created=x" }), { status: 200 }));
    await expect(h.client.call("createBrand", [])).resolves.toBeUndefined();
    expect(h.navigate).toHaveBeenCalledWith("/admin/brands?created=x");
  });

  it("reports a missing page, a dead session and a failed action in distinct ways", async () => {
    const gone = harness(() => new Response(JSON.stringify({ ok: false, notFound: true }), { status: 404 }));
    await expect(gone.client.call("getAdminBrand", ["x"])).rejects.toBeInstanceOf(AdminNotFoundError);

    const expired = harness(() => new Response(JSON.stringify({ ok: false, error: { code: "unauthorized" } }), { status: 401 }));
    await expect(expired.client.call("getAdminBrands", [])).rejects.toThrow();
    expect(expired.onUnauthorized).toHaveBeenCalledTimes(1);

    const failed = harness(() => new Response(JSON.stringify({ ok: false, error: { code: "action_failed", message: "Не удалось" } }), { status: 500 }));
    await expect(failed.client.call("deleteBrand", [])).rejects.toThrow("Не удалось");
    expect(failed.onUnauthorized).not.toHaveBeenCalled();
  });
});

describe("rpc client read cache", () => {
  it("answers a repeated read from memory and refreshes it in the background only when old", async () => {
    let version = 1;
    const h = harness(() => ok({ version }));
    expect(await h.client.read("getAdminBrands", [])).toEqual({ version: 1 });
    expect(h.calls).toHaveLength(1);

    version = 2;
    h.clock.now += 1000;
    expect(await h.client.read("getAdminBrands", [])).toEqual({ version: 1 });
    expect(h.calls).toHaveLength(1);

    h.clock.now += 5000;
    const listener = vi.fn();
    h.client.subscribe(listener);
    expect(await h.client.read("getAdminBrands", [])).toEqual({ version: 1 });
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(await h.client.read("getAdminBrands", [])).toEqual({ version: 2 });
    expect(h.calls).toHaveLength(2);
  });

  it("does not notify when the refreshed data is identical", async () => {
    const h = harness(() => ok({ same: true }));
    await h.client.read("getAdminBrands", []);
    h.clock.now += 5000;
    const listener = vi.fn();
    h.client.subscribe(listener);
    await h.client.read("getAdminBrands", []);
    await vi.waitFor(() => expect(h.calls).toHaveLength(2));
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();
  });

  it("keys the cache by arguments and shares one request between simultaneous readers", async () => {
    const h = harness((_name, args) => ok(args[0]));
    const [a, b, c] = await Promise.all([
      h.client.read("getAdminBrand", ["a"]),
      h.client.read("getAdminBrand", ["a"]),
      h.client.read("getAdminBrand", ["b"]),
    ]);
    expect([a, b, c]).toEqual(["a", "a", "b"]);
    expect(h.calls).toHaveLength(2);
  });

  it("makes the next read wait for fresh data after any action changed something", async () => {
    let version = 1;
    const h = harness((name) => (name === "deleteBrand" ? ok(null) : ok({ version })));
    await h.client.read("getAdminBrands", []);
    version = 2;
    await h.client.call("deleteBrand", ["x"]);
    expect(await h.client.read("getAdminBrands", [])).toEqual({ version: 2 });
  });

  it("serves the last known data instantly through peek and lets a prefetch warm the cache", async () => {
    const h = harness(() => ok([1, 2, 3]));
    expect(h.client.peek("getAdminBrands", [])).toBeUndefined();
    await h.client.prefetch("getAdminBrands", []);
    expect(h.client.peek("getAdminBrands", [])).toEqual({ value: [1, 2, 3] });
  });

  it("does not cache a failed read", async () => {
    let fail = true;
    const h = harness(() => (fail ? new Response(JSON.stringify({ ok: false, error: { code: "action_failed", message: "x" } }), { status: 500 }) : ok("fine")));
    await expect(h.client.read("getAdminBrands", [])).rejects.toThrow();
    fail = false;
    expect(await h.client.read("getAdminBrands", [])).toBe("fine");
  });
});
