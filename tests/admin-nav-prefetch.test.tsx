// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminNav } from "@/components/admin/AdminNav";

const prefetch = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/products",
  useRouter: () => ({ prefetch }),
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

afterEach(() => {
  cleanup();
  prefetch.mockClear();
});

describe("AdminNav prefetch", () => {
  it("прогревает целевой раздел до клика", () => {
    render(<AdminNav variant="sidebar" />);

    fireEvent.pointerEnter(screen.getByRole("link", { name: "Бренды" }));

    expect(prefetch).toHaveBeenCalledWith("/admin/brands");
  });

  it("не запрашивает повторно уже открытый раздел", () => {
    render(<AdminNav variant="sidebar" />);

    fireEvent.pointerEnter(screen.getByRole("link", { name: "Товары" }));

    expect(prefetch).not.toHaveBeenCalled();
  });
});
