import { describe, expect, it } from "vitest";
import { formatRussianCount } from "@/lib/russian-plural";

const PRODUCT_FORMS = ["товар", "товара", "товаров"] as const;

describe("formatRussianCount", () => {
  it.each([
    [1, "1 товар"],
    [2, "2 товара"],
    [5, "5 товаров"],
    [11, "11 товаров"],
    [21, "21 товар"],
    [22, "22 товара"],
    [25, "25 товаров"],
  ])("formats %i with the correct Russian form", (count, expected) => {
    expect(formatRussianCount(count, PRODUCT_FORMS)).toBe(expected);
  });
});
