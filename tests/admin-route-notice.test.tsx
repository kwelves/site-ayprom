/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminRouteNotice } from "@/components/admin/AdminRouteNotice";
import { AdminToastProvider } from "@/components/admin/ui/AdminToastProvider";

const navigation = vi.hoisted(() => ({
  pathname: "/admin/products",
  replace: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.searchParams,
}));

beforeEach(() => {
  navigation.pathname = "/admin/products";
  navigation.replace.mockReset();
  navigation.searchParams = new URLSearchParams();
});

afterEach(cleanup);

describe("AdminRouteNotice", () => {
  it("показывает подтверждение удаления и удаляет одноразовый параметр из адреса", async () => {
    navigation.searchParams = new URLSearchParams("notice=product-deleted&page=2");

    render(
      <AdminToastProvider>
        <AdminRouteNotice />
      </AdminToastProvider>,
    );

    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Товар успешно удалён"));
    expect(navigation.replace).toHaveBeenCalledWith("/admin/products?page=2", { scroll: false });
  });

  it("игнорирует неизвестное уведомление", () => {
    navigation.searchParams = new URLSearchParams("notice=unknown");

    render(
      <AdminToastProvider>
        <AdminRouteNotice />
      </AdminToastProvider>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});
