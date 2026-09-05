// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NavDropdown } from "@/components/layout/NavDropdown";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/use-hash-nav-click", () => ({
  useHashNavClick: () => () => undefined,
}));

const items = [
  { href: "/catalog/category/nasosy", label: "Насосы", description: "Шестерённые и поршневые" },
  { href: "/catalog/category/klapany", label: "Клапаны", description: "Предохранительные" },
];

function renderDropdown() {
  const view = render(<NavDropdown label="Каталог" href="/catalog" items={items} />);
  const trigger = screen.getByRole("link", { name: /Каталог/ });
  const panelId = trigger.getAttribute("aria-controls")!;
  const panel = () => document.getElementById(panelId)!;
  return { view, trigger, panel };
}

afterEach(cleanup);

describe("NavDropdown", () => {
  it("в закрытом состоянии не пропускает ни курсор, ни фокус, ни скринридер", () => {
    const { trigger, panel } = renderDropdown();

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel().getAttribute("aria-hidden")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().className).toContain("pointer-events-none");
    expect(panel().className).toContain("opacity-0");
    // Ссылки (и логотипы марок вместе с ними) не попадают в первую загрузку.
    expect(panel().querySelectorAll("a")).toHaveLength(0);
  });

  it("открывается по наведению и закрывается при уходе курсора", () => {
    const { view, trigger, panel } = renderDropdown();
    const container = view.container.firstElementChild!;

    fireEvent.mouseEnter(container);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(false);
    expect(panel().getAttribute("aria-hidden")).toBe("false");
    expect(panel().className).toContain("opacity-100");
    expect(screen.getByRole("link", { name: /Насосы/ })).not.toBeNull();

    fireEvent.mouseLeave(container);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(panel().className).toContain("pointer-events-none");
  });

  it("открывается при получении фокуса с клавиатуры", () => {
    const { trigger, panel } = renderDropdown();

    fireEvent.focus(trigger);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(panel().hasAttribute("inert")).toBe(false);
    // Панель уже не inert, поэтому следующий Tab уводит фокус внутрь списка.
    expect(panel().querySelectorAll("a")).toHaveLength(items.length);
  });

  it("Escape закрывает панель и возвращает фокус на триггер", () => {
    const { view, trigger, panel } = renderDropdown();
    const container = view.container.firstElementChild!;

    fireEvent.focus(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(container, { key: "Escape" });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(panel().hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("панель абсолютная, поэтому её появление не двигает шапку", () => {
    const { panel } = renderDropdown();

    expect(panel().className).toContain("absolute");
    expect(panel().className).toContain("transition-[opacity,translate]");
  });
});
