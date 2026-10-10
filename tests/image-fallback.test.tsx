// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageFallback } from "@/components/ui/ImageFallback";

vi.mock("next/image", () => ({
  default: ({ fill, unoptimized, alt, ...props }: React.ComponentProps<"img"> & { fill?: boolean; unoptimized?: boolean }) => {
    void fill;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- isolated unit-test stand-in for next/image
      <img alt={alt ?? ""} data-unoptimized={String(unoptimized)} {...props} />
    );
  },
}));

afterEach(() => { cleanup(); vi.useRealTimers(); });

// A broken image is retried (cache-busted) three times, after 0.5, 1.5 and 3.5 s, before the placeholder appears.
function failEverySourceOnce() {
  fireEvent.error(screen.getByAltText("Товар"));
}


describe("ImageFallback", () => {
  it("tries the durable master before showing the no-photo placeholder", () => {
    render(
      <ImageFallback
        src="/variants/thumbnail.webp"
        fallbackSrc="/masters/product.jpg"
        alt="Товар"
        sizes="100vw"
        unoptimized
      />,
    );

    const variant = screen.getByAltText("Товар");
    expect(variant.getAttribute("src")).toBe("/variants/thumbnail.webp");
    expect(variant.getAttribute("data-unoptimized")).toBe("true");

    fireEvent.error(variant);
    const master = screen.getByAltText("Товар");
    expect(master.getAttribute("src")).toBe("/masters/product.jpg");
    expect(screen.queryByText("Фотография пока не добавлена")).toBeNull();

    fireEvent.error(master);
    // The placeholder is not shown yet: the photo gets two more chances first.
    expect(screen.queryByText("Фотография пока не добавлена")).toBeNull();
  });

  it("retries a failed photo three times with a cache-busting parameter, then shows the placeholder", () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    render(<ImageFallback src="/variants/a.webp" fallbackSrc="/masters/a.jpg" alt="Товар" sizes="100vw" onError={onError} />);
    failEverySourceOnce(); // variant -> master
    failEverySourceOnce(); // master fails -> waiting for retry 1
    expect(screen.queryByAltText("Товар")).toBeNull();
    expect(onError).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/variants/a.webp?_r=1");
    failEverySourceOnce(); // -> master (also busted)
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/masters/a.jpg?_r=1");
    failEverySourceOnce(); // -> waiting for retry 2
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/variants/a.webp?_r=2");
    failEverySourceOnce();
    failEverySourceOnce(); // -> waiting for retry 3
    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/variants/a.webp?_r=3");
    failEverySourceOnce();
    failEverySourceOnce();

    expect(screen.getByText("Фотография пока не добавлена")).toBeTruthy();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("recovers from a transient network failure without ever showing the placeholder", async () => {
    vi.useFakeTimers();
    const onLoad = vi.fn();
    render(<ImageFallback src="/images/only.webp" alt="Товар" sizes="100vw" onLoad={onLoad} />);
    failEverySourceOnce();
    expect(screen.queryByText("Фотография пока не добавлена")).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    const retried = screen.getByAltText("Товар");
    expect(retried.getAttribute("src")).toBe("/images/only.webp?_r=1");
    Object.defineProperty(retried, "decode", { configurable: true, value: () => Promise.resolve() });
    await act(async () => { fireEvent.load(retried); await Promise.resolve(); });
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Фотография пока не добавлена")).toBeNull();
  });

  it("does not touch a source that already has a query string incorrectly, and stops timers on unmount", () => {
    vi.useFakeTimers();
    const view = render(<ImageFallback src="/images/q.webp?v=3" alt="Товар" sizes="100vw" />);
    failEverySourceOnce();
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/images/q.webp?v=3&_r=1");
    failEverySourceOnce();
    view.unmount();
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
  });

  it("starts the fallback chain again when either source changes", () => {
    const view = render(
      <ImageFallback src="/variants/one.webp" fallbackSrc="/masters/one.jpg" alt="Товар" sizes="100vw" />,
    );
    vi.useFakeTimers();
    fireEvent.error(screen.getByAltText("Товар")); // variant -> master
    fireEvent.error(screen.getByAltText("Товар")); // master -> waiting
    act(() => { vi.advanceTimersByTime(500); });
    fireEvent.error(screen.getByAltText("Товар"));
    fireEvent.error(screen.getByAltText("Товар"));
    act(() => { vi.advanceTimersByTime(1500); });
    fireEvent.error(screen.getByAltText("Товар"));
    fireEvent.error(screen.getByAltText("Товар"));
    act(() => { vi.advanceTimersByTime(3500); });
    fireEvent.error(screen.getByAltText("Товар"));
    fireEvent.error(screen.getByAltText("Товар"));
    expect(screen.getByText("Фотография пока не добавлена")).toBeTruthy();

    view.rerender(
      <ImageFallback src="/variants/one.webp" fallbackSrc="/masters/two.jpg" alt="Товар" sizes="100vw" />,
    );
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/variants/one.webp");

    view.rerender(
      <ImageFallback src="/variants/two.webp" fallbackSrc="/masters/two.jpg" alt="Товар" sizes="100vw" />,
    );
    expect(screen.getByAltText("Товар").getAttribute("src")).toBe("/variants/two.webp");
  });

  it("reports an image as ready only after the browser has decoded it", async () => {
    const onLoad = vi.fn();
    let resolveDecode!: () => void;
    const decode = vi.fn(() => new Promise<void>((resolve) => {
      resolveDecode = resolve;
    }));

    render(<ImageFallback src="/image.webp" alt="Товар" sizes="100vw" onLoad={onLoad} />);
    const image = screen.getByAltText("Товар");
    Object.defineProperty(image, "decode", { configurable: true, value: decode });

    fireEvent.load(image);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(onLoad).not.toHaveBeenCalled();

    await act(async () => {
      resolveDecode();
      await Promise.resolve();
    });

    await waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
  });
});
