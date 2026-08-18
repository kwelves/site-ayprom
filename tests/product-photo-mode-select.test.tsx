// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductPhotoModeSelect } from "@/components/admin/ProductPhotoModeSelect";
import type { ProductPhotoMode } from "@/lib/admin/product-photo-mode";

afterEach(cleanup);

describe("ProductPhotoModeSelect", () => {
  it("shows the four modes with the selected one active", () => {
    render(<ProductPhotoModeSelect value="normal" onChange={vi.fn()} />);
    const select = screen.getByLabelText("Режим добавления фото") as HTMLSelectElement;

    expect(select.value).toBe("normal");
    expect(screen.getAllByRole("option")).toHaveLength(4);
  });

  it("shows a description matching the selected mode", () => {
    render(<ProductPhotoModeSelect value="script" onChange={vi.fn()} />);
    // getByText throws if no match is found, so reaching the assertion below
    // already proves the description rendered.
    expect(screen.getByText(/обрезает фото по границам детали/).textContent?.length).toBeGreaterThan(0);
  });

  it("calls onChange with the newly picked mode", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn<(mode: ProductPhotoMode) => void>();
    render(<ProductPhotoModeSelect value="normal" onChange={onChange} />);

    await user.selectOptions(screen.getByLabelText("Режим добавления фото"), "Скрипт + WebP");

    expect(onChange).toHaveBeenCalledWith("script-webp");
  });
});
