import { describe, expect, it, vi } from "vitest";
import { isPhotoQueueMode, queueStagedImages, requestPhotoWorker } from "@/lib/photo-queue/enqueue";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "22222222-2222-4222-8222-222222222222";
const IDS = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];

function fakeSupabase(result: { data: unknown; error: unknown }) {
  const rpc = vi.fn(async () => result);
  return { client: { rpc } as never, rpc };
}

const dispatchEnv = {
  GITHUB_DISPATCH_TOKEN: "ghp_test_token_value",
  GITHUB_REPOSITORY: "kwelves/site-ayprom",
  PHOTO_WORKFLOW_FILE: "photo-queue.yml",
  PHOTO_WORKFLOW_REF: "photo-worker",
};

describe("photo queue mode", () => {
  it("is on only when the environment says so", () => {
    expect(isPhotoQueueMode({ PHOTO_PROCESSING: "queue" })).toBe(true);
    expect(isPhotoQueueMode({ PHOTO_PROCESSING: "inline" })).toBe(false);
    expect(isPhotoQueueMode({})).toBe(false);
  });
});

describe("queueStagedImages", () => {
  it("queues the chosen photos in the admin's order and wakes the worker once", async () => {
    const { client, rpc } = fakeSupabase({ data: 2, error: null });
    const wake = vi.fn(async () => true);
    const count = await queueStagedImages(client, { draftId: DRAFT, stagingIds: IDS, productId: PRODUCT, photoMode: "script-webp" }, wake);
    expect(count).toBe(2);
    expect(rpc).toHaveBeenCalledWith("queue_product_image_staging", { p_draft: DRAFT, p_ids: IDS, p_product: PRODUCT, p_mode: "script-webp" });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("does not wake the worker when nothing was queued, and reports database errors", async () => {
    const none = fakeSupabase({ data: 0, error: null });
    const wake = vi.fn(async () => true);
    expect(await queueStagedImages(none.client, { draftId: DRAFT, stagingIds: IDS, productId: PRODUCT, photoMode: "normal" }, wake)).toBe(0);
    expect(wake).not.toHaveBeenCalled();
    const broken = fakeSupabase({ data: null, error: { code: "22023", message: "x" } });
    await expect(queueStagedImages(broken.client, { draftId: DRAFT, stagingIds: IDS, productId: PRODUCT, photoMode: "normal" }, wake)).rejects.toBeTruthy();
  });
});

describe("requestPhotoWorker", () => {
  it("asks GitHub to start the photo workflow on the configured branch", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await requestPhotoWorker(dispatchEnv, fetchImpl as unknown as typeof fetch)).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/kwelves/site-ayprom/actions/workflows/photo-queue.yml/dispatches");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ ref: "photo-worker" });
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer ghp_test_token_value");
    expect(headers.get("accept")).toBe("application/vnd.github+json");
    expect(headers.get("user-agent")).toBeTruthy();
  });

  it("does nothing when GitHub is not configured (a local runner picks the jobs up by itself)", async () => {
    const fetchImpl = vi.fn();
    expect(await requestPhotoWorker({}, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(await requestPhotoWorker({ ...dispatchEnv, GITHUB_DISPATCH_TOKEN: "" }, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("never lets a GitHub failure break saving a product, and never logs the token", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.join(" ")); });
    const refused = vi.fn(async () => new Response("no", { status: 403 }));
    expect(await requestPhotoWorker(dispatchEnv, refused as unknown as typeof fetch)).toBe(false);
    const down = vi.fn(async () => { throw new TypeError("network down ghp_test_token_value"); });
    expect(await requestPhotoWorker(dispatchEnv, down as unknown as typeof fetch)).toBe(false);
    spy.mockRestore();
    expect(logged.join(" ")).not.toContain("ghp_test_token_value");
  });

  it("names the GitHub environment (staging or production) only when one is configured", async () => {
    const withEnvironment = vi.fn(async () => new Response(null, { status: 204 }));
    expect(await requestPhotoWorker({ ...dispatchEnv, WORKFLOW_ENVIRONMENT: "production" }, withEnvironment as unknown as typeof fetch)).toBe(true);
    expect(JSON.parse(String((withEnvironment.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ ref: "photo-worker", inputs: { environment: "production" } });
    const without = vi.fn(async () => new Response(null, { status: 204 }));
    await requestPhotoWorker(dispatchEnv, without as unknown as typeof fetch);
    expect(JSON.parse(String((without.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ ref: "photo-worker" });
  });

  it("refuses an unknown environment name instead of sending it to GitHub", async () => {
    const fetchImpl = vi.fn();
    for (const value of ["prod", "Production", "staging; rm", "../production"]) {
      expect(await requestPhotoWorker({ ...dispatchEnv, WORKFLOW_ENVIRONMENT: value }, fetchImpl as unknown as typeof fetch)).toBe(false);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a repository or workflow value that could redirect the request elsewhere", async () => {
    const fetchImpl = vi.fn();
    expect(await requestPhotoWorker({ ...dispatchEnv, GITHUB_REPOSITORY: "../evil/repo" }, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(await requestPhotoWorker({ ...dispatchEnv, PHOTO_WORKFLOW_FILE: "a/b.yml" }, fetchImpl as unknown as typeof fetch)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("stageAndQueueFile (edit mode: one photo added to an existing product)", () => {
  function fakeStore(options: { uploadError?: unknown } = {}) {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const uploads: Array<{ path: string; type: string | undefined; size: number }> = [];
    const answer = (name: string) => {
      if (name === "claim_product_image_staging") return { data: { out_id: "55555555-5555-4555-8555-555555555555", out_expires_at: "x" }, error: null };
      if (name === "queue_product_image_staging") return { data: 1, error: null };
      return { data: 0, error: null };
    };
    const client = {
      rpc: (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        const result = answer(name);
        return Object.assign(Promise.resolve(result), { single: async () => result });
      },
      storage: {
        from: () => ({
          upload: async (path: string, body: Uint8Array, init: { contentType?: string }) => {
            uploads.push({ path, type: init.contentType, size: body.byteLength });
            return { error: options.uploadError ?? null };
          },
        }),
      },
    };
    return { client: client as never, calls, uploads };
  }

  it("stores the file privately, registers it, queues it for the product and wakes the worker", async () => {
    const { stageAndQueueFile } = await import("@/lib/photo-queue/enqueue");
    const store = fakeStore();
    const wake = vi.fn(async () => true);
    const file = new File([new Uint8Array(1500)], "x.jpg", { type: "image/jpeg" });
    const result = await stageAndQueueFile(store.client, { productId: PRODUCT, file }, wake);
    expect(result).toEqual({ pending: true, id: "55555555-5555-4555-8555-555555555555" });
    expect(store.uploads).toHaveLength(1);
    expect(store.uploads[0]).toMatchObject({ type: "image/jpeg", size: 1500 });
    expect(store.uploads[0].path).toMatch(/\.jpg$/);
    const names = store.calls.map((call) => call.name);
    expect(names).toEqual(["claim_product_image_staging", "queue_product_image_staging"]);
    expect(store.calls[1].args).toMatchObject({ p_product: PRODUCT, p_mode: "normal", p_ids: ["55555555-5555-4555-8555-555555555555"] });
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it("gives the registration back when the file could not be stored", async () => {
    const { stageAndQueueFile } = await import("@/lib/photo-queue/enqueue");
    const store = fakeStore({ uploadError: { message: "storage down" } });
    await expect(stageAndQueueFile(store.client, { productId: PRODUCT, file: new File([new Uint8Array(10)], "x.png", { type: "image/png" }) }, vi.fn())).rejects.toBeTruthy();
    expect(store.calls.map((call) => call.name)).toEqual(["claim_product_image_staging", "release_product_image_staging"]);
  });

  it("refuses a file type the pipeline does not accept", async () => {
    const { stageAndQueueFile } = await import("@/lib/photo-queue/enqueue");
    const store = fakeStore();
    await expect(stageAndQueueFile(store.client, { productId: PRODUCT, file: new File([new Uint8Array(10)], "x.gif", { type: "image/gif" }) }, vi.fn())).rejects.toThrow();
    expect(store.calls).toHaveLength(0);
  });
});
