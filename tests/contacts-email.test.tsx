// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ContactsPage from "@/app/(site)/contacts/page";
import { CORPORATE_EMAIL } from "@/lib/contact-info";

vi.mock("@/components/motion/Reveal", () => ({ Reveal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/motion/HoverBorderGrid", () => ({ HoverBorderGrid: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/components/motion/Stagger", () => ({
  StaggerGroup: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
  StaggerItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

describe("страница «Контакты»: корпоративная почта", () => {
  it("общий адрес почты — info@ayprom-gidravlika.kg", () => {
    expect(CORPORATE_EMAIL).toBe("info@ayprom-gidravlika.kg");
  });

  it("показывает почту карточкой-ссылкой, которая открывает письмо", () => {
    render(<ContactsPage />);
    const link = screen.getByRole("link", { name: /info@ayprom-gidravlika\.kg/ });
    expect(link.getAttribute("href")).toBe(`mailto:${CORPORATE_EMAIL}`);
  });

  it("сохраняет шесть карточек, чтобы сетка 2 и 3 колонки не оставляла неполный ряд, и не теряет поставки", () => {
    const { container } = render(<ContactsPage />);
    expect(container.querySelectorAll("a.rounded-xl, div.rounded-xl")).toHaveLength(6);
    expect(screen.getAllByText(/Кыргызстан и страны СНГ/)).toHaveLength(1);
  });
});
