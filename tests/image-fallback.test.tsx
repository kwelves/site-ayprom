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

afterEach(cleanup);

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
    expect(screen.getByText("Фотография пока не добавлена")).toBeTruthy();
  });

  it("starts the fallback chain again when either source changes", () => {
    const view = render(
      <ImageFallback src="/variants/one.webp" fallbackSrc="/masters/one.jpg" alt="Товар" sizes="100vw" />,
    );
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
