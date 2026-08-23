// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProtectedAdminLayout from "@/app/admin/(protected)/layout";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/admin/actions", () => ({ logout: vi.fn() }));
vi.mock("@/components/admin/AdminNav", () => ({ AdminNav: () => <span>Навигация</span> }));
vi.mock("@/components/admin/AdminMobileNav", () => ({ AdminMobileNav: () => <button>Меню</button> }));
vi.mock("@/components/admin/AdminRouteNotice", () => ({ AdminRouteNotice: () => null }));

afterEach(cleanup);

describe("ProtectedAdminLayout", () => {
  it("keeps the desktop logout action pinned to the viewport instead of page height", () => {
    render(
      <ProtectedAdminLayout>
        <div>Длинная страница</div>
      </ProtectedAdminLayout>,
    );

    const shell = screen.getByTestId("admin-shell");
    const sidebar = screen.getByTestId("admin-sidebar");
    const navigation = screen.getByRole("navigation");
    const logout = screen.getByTestId("admin-logout");

    expect([...shell.classList]).toContain("min-h-dvh");
    expect([...sidebar.classList]).toEqual(
      expect.arrayContaining(["lg:sticky", "lg:top-0", "lg:h-dvh", "lg:self-start"]),
    );
    expect([...navigation.classList]).toEqual(expect.arrayContaining(["min-h-0", "overflow-y-auto"]));
    expect([...logout.classList]).toContain("shrink-0");
  });
});
