import { beforeEach, describe, expect, it, vi } from "vitest";

// A plain recorder instead of vi.fn: this suite also checks that a throwing hint is swallowed.
const hints = vi.hoisted(() => ({ calls: [] as unknown[][], fail: false }));
vi.mock("react-dom", () => ({
  preload: (...args: unknown[]) => {
    if (hints.fail) throw new Error("no render context");
    hints.calls.push(args);
  },
}));

import { preloadGalleryImages } from "@/lib/preload-gallery-images";

beforeEach(() => { hints.calls = []; hints.fail = false; });

describe("preloadGalleryImages", () => {
  it("asks the browser to fetch every photo after the first at low priority, right from the HTML head", () => {
    preloadGalleryImages([{ url: "/a.webp" }, { url: "/b.webp" }, { url: "/c.webp" }]);
    expect(hints.calls).toEqual([
      ["/b.webp", { as: "image", fetchPriority: "low" }],
      ["/c.webp", { as: "image", fetchPriority: "low" }],
    ]);
  });

  it("does nothing for a single photo, skips empty and repeated addresses, and is capped", () => {
    preloadGalleryImages([{ url: "/only.webp" }]);
    preloadGalleryImages([{ url: "/a.webp" }, { url: "" }, { url: "/a.webp" }, { url: "/b.webp" }, { url: "/b.webp" }]);
    expect(hints.calls.map((call) => call[0])).toEqual(["/b.webp"]);
    hints.calls = [];
    preloadGalleryImages(Array.from({ length: 40 }, (_unused, index) => ({ url: `/p${index}.webp` })));
    expect(hints.calls).toHaveLength(12);
  });

  it("never lets a failing hint break the page", () => {
    hints.fail = true;
    expect(() => preloadGalleryImages([{ url: "/a.webp" }, { url: "/b.webp" }])).not.toThrow();
  });
});
