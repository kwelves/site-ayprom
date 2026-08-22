// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { usePreparedImageCarousel } from "@/components/ui/PreparedImageCarousel";

const images = [
  { url: "/one.webp" },
  { url: "/two.webp" },
  { url: "/three.webp" },
];

describe("usePreparedImageCarousel", () => {
  it("keeps a loaded pending image ready when its active indicator is selected again", () => {
    const { result } = renderHook(() => usePreparedImageCarousel(images));

    act(() => result.current.step(1));
    const pendingKey = result.current.selectedKey;
    act(() => result.current.markReady(pendingKey));
    expect(result.current.committedIndex).toBe(1);
    expect(result.current.hasPendingImage).toBe(false);

    act(() => result.current.select(result.current.selectedIndex));
    expect(result.current.committedIndex).toBe(1);
    expect(result.current.hasPendingImage).toBe(false);
  });

  it("rejects a stale decoded image after a newer selection", () => {
    const { result } = renderHook(() => usePreparedImageCarousel(images));

    act(() => result.current.step(1));
    const staleKey = result.current.selectedKey;
    act(() => result.current.step(1));

    act(() => result.current.markReady(staleKey));

    expect(result.current.selectedIndex).toBe(2);
    expect(result.current.committedIndex).toBe(0);
    expect(result.current.hasPendingImage).toBe(true);
  });
});
