// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageFallback } from "@/components/ui/ImageFallback";

vi.mock("next/image", () => ({
  default: ({ fill, alt, ...props }: React.ComponentProps<"img"> & { fill?: boolean }) => {
    void fill;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- isolated unit-test stand-in for next/image
      <img alt={alt ?? ""} {...props} />
    );
  },
}));

afterEach(cleanup);

describe("ImageFallback", () => {
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
