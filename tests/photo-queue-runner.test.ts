import { describe, expect, it, vi } from "vitest";
import { cleanupAbandonedStaging, runPhotoQueue, type QueueJob, type QueuePorts } from "@/lib/photo-queue/runner";

const job = (id: string, over: Partial<QueueJob> = {}): QueueJob => ({
  id,
  object_path: `product-image-staging/draft/${id}.png`,
  content_type: "image/png",
  queued_product_id: "product-1",
  queued_photo_mode: "normal",
  attempts: 1,
  ...over,
});

function ports(jobs: QueueJob[], over: Partial<QueuePorts> = {}) {
  const queue = [...jobs];
  const log: string[] = [];
  const impl: QueuePorts = {
    claim: async () => queue.shift() ?? null,
    productInfo: async () => ({ slug: "pump-1", imageCount: 2 }),
    attach: async (claimed, info) => { log.push(`attach ${claimed.id} order=${info.imageCount}`); return { inserted: true }; },
    fail: async (id, retry) => { log.push(`fail ${id} retry=${retry}`); },
    ...over,
  };
  return { impl, log };
}

describe("runPhotoQueue", () => {
  it("processes every waiting photo, then stops when the queue is empty", async () => {
    const { impl, log } = ports([job("a"), job("b")]);
    const result = await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000 });
    expect(result).toEqual({ processed: 2, failed: 0, stopped: "empty" });
    expect(log).toEqual(["attach a order=2", "attach b order=2"]);
  });

  it("asks for the product's current photo count before each photo, so the order keeps growing", async () => {
    let count = 0;
    const seen: number[] = [];
    const { impl } = ports([job("a"), job("b"), job("c")], {
      productInfo: async () => ({ slug: "pump-1", imageCount: count }),
      attach: async (_claimed, info) => { seen.push(info.imageCount); count += 1; return { inserted: true }; },
    });
    await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000 });
    expect(seen).toEqual([0, 1, 2]);
  });

  it("gives a failed photo another try later and keeps going with the next one", async () => {
    const { impl, log } = ports([job("a"), job("b")], {
      attach: async (claimed) => {
        if (claimed.id === "a") throw new Error("decoder exploded with a secret path /srv/key");
        return { inserted: true };
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000 });
    errors.mockRestore();
    expect(result).toEqual({ processed: 1, failed: 1, stopped: "empty" });
    expect(log).toContain("fail a retry=true");
  });

  it("gives up at once on a photo whose product no longer exists", async () => {
    const { impl, log } = ports([job("a")], { productInfo: async () => null });
    const result = await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000 });
    expect(result.failed).toBe(1);
    expect(log).toEqual(["fail a retry=false"]);
  });

  it("turns a photo down for good when the product already holds the maximum", async () => {
    const { impl, log } = ports([job("a")], { productInfo: async () => ({ slug: "pump-1", imageCount: 10 }) });
    const result = await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000, maxImages: 10 });
    expect(result.failed).toBe(1);
    expect(log).toEqual(["fail a retry=false"]);
  });

  it("stops before its time budget runs out and leaves the rest queued", async () => {
    let clock = 0;
    const { impl } = ports([job("a"), job("b"), job("c")], { attach: async () => { clock += 40_000; return { inserted: true }; } });
    const result = await runPhotoQueue(impl, { now: () => clock, deadlineMs: 60_000 });
    expect(result.stopped).toBe("deadline");
    expect(result.processed).toBe(2);
  });

  it("does not print what went wrong inside a photo into the log", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(" ")); });
    const { impl } = ports([job("a")], { attach: async () => { throw new Error("secret-token-123 in message"); } });
    await runPhotoQueue(impl, { now: () => 0, deadlineMs: 60_000 });
    spy.mockRestore();
    expect(logged.join(" ")).not.toContain("secret-token-123");
  });
});

describe("cleanupAbandonedStaging", () => {
  it("removes the files first and only then frees the records", async () => {
    const order: string[] = [];
    const removed = await cleanupAbandonedStaging({
      list: async () => [{ out_id: "1", out_object_path: "p/1.png" }, { out_id: "2", out_object_path: "p/2.png" }],
      removeFiles: async (paths) => { order.push(`files ${paths.join(",")}`); },
      release: async (ids) => { order.push(`release ${ids.join(",")}`); },
    });
    expect(removed).toBe(2);
    expect(order).toEqual(["files p/1.png,p/2.png", "release 1,2"]);
  });

  it("keeps the records when removing the files failed", async () => {
    const release = vi.fn();
    await expect(cleanupAbandonedStaging({
      list: async () => [{ out_id: "1", out_object_path: "p/1.png" }],
      removeFiles: async () => { throw new Error("storage down"); },
      release,
    })).rejects.toThrow();
    expect(release).not.toHaveBeenCalled();
  });

  it("does nothing when nothing is abandoned", async () => {
    const removeFiles = vi.fn();
    expect(await cleanupAbandonedStaging({ list: async () => [], removeFiles, release: vi.fn() })).toBe(0);
    expect(removeFiles).not.toHaveBeenCalled();
  });
});
