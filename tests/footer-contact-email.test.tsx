// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Footer } from "@/components/layout/Footer";

vi.mock("next/image", () => ({
  default: (props: { alt: string }) => <span role="img" aria-label={props.alt} />,
}));
vi.mock("@/components/layout/FooterBackground", () => ({ FooterBackground: () => null }));
vi.mock("@/components/motion/Reveal", () => ({ Reveal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/use-hash-nav-click", () => ({ useHashNavClick: () => () => undefined }));

describe("футер: корпоративная почта", () => {
  it("показывает info@ayprom-gidravlika.kg ссылкой, которая открывает письмо", () => {
    render(<Footer categories={[]} brands={[]} />);
    const link = screen.getByRole("link", { name: "info@ayprom-gidravlika.kg" });
    expect(link.getAttribute("href")).toBe("mailto:info@ayprom-gidravlika.kg");
  });
});
