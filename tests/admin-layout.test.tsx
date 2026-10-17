// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProtectedAdminLayout from "@/app/admin/(protected)/layout";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

vi.mock("@/lib/admin/actions", () => ({ logout: vi.fn() }));
vi.mock("@/components/admin/AdminNav", () => ({ AdminNav: () => <span>Навигация</span> }));
vi.mock("@/components/admin/AdminTopBar", () => ({ AdminTopBar: () => <header>Верхняя полоса</header> }));
vi.mock("@/components/admin/AdminPublicationStatus", () => ({ AdminPublicationStatus: () => null }));
vi.mock("@/components/admin/AdminRouteNotice", () => ({ AdminRouteNotice: () => null }));

afterEach(cleanup);

describe("ProtectedAdminLayout", () => {
  it("keeps the desktop sidebar and its logout action pinned to the viewport instead of page height", () => {
    render(
      <ProtectedAdminLayout>
        <div>Длинная страница</div>
      </ProtectedAdminLayout>,
    );

    const shell = screen.getByTestId("admin-shell");
    const sidebar = screen.getByTestId("admin-sidebar");
    const navigation = screen.getByRole("navigation", { name: "Разделы админки" });
    const logout = screen.getByTestId("admin-logout");

    expect([...shell.classList]).toContain("min-h-dvh");
    expect([...sidebar.classList]).toEqual(
      expect.arrayContaining(["lg:sticky", "lg:top-3", "lg:h-[calc(100dvh-1.5rem)]", "lg:self-start"]),
    );
    expect([...navigation.classList]).toEqual(expect.arrayContaining(["min-h-0", "overflow-y-auto"]));
    expect([...logout.classList]).toContain("shrink-0");
  });

  it("puts the page on the scene next to the sidebar, inside one main region", () => {
    render(
      <ProtectedAdminLayout>
        <div>Страница</div>
      </ProtectedAdminLayout>,
    );

    expect(screen.getByRole("main").textContent).toContain("Страница");
    expect(screen.getByText("Верхняя полоса")).toBeTruthy();
  });
});
