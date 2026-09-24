// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ProductFormBasicSection } from "@/components/admin/product-form/ProductFormBasicSection";

afterEach(cleanup);

function Form({ mode }: { mode: "create" | "edit" }) {
  const [slug, setSlug] = useState("original-product");
  return <form aria-label="Товар"><ProductFormBasicSection mode={mode}
    name="Товар" onNameChange={() => {}} slug={slug} onSlugChange={setSlug}
    categorySlug="parts" onCategoryChange={() => {}} subcategorySlug=""
    onSubcategoryChange={() => {}} categories={[]} categorySubcategories={[]}
    published={true} onPublishedChange={() => {}} hotspotCount={0}
    availability="in_stock" onAvailabilityChange={() => {}} /></form>;
}

describe("product slug field", () => {
  for (const mode of ["create", "edit"] as const) {
    it(`submits an explicitly edited slug in ${mode} mode`, async () => {
      const user = userEvent.setup();
      render(<Form mode={mode} />);
      const input = screen.getByLabelText("Адрес (slug)") as HTMLInputElement;
      expect(input.disabled).toBe(false);
      await user.clear(input);
      await user.type(input, "custom-product-42");
      const form = screen.getByRole("form") as HTMLFormElement;
      expect(new FormData(form).get("slug")).toBe("custom-product-42");
    });
  }
});
