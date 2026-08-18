import { describe, expect, it } from "vitest";
import {
  DEFAULT_PRODUCT_AVAILABILITY,
  isProductAvailability,
  PRODUCT_AVAILABILITY_LABELS,
  PRODUCT_AVAILABILITY_OPTIONS,
} from "@/lib/admin/product-availability";

describe("isProductAvailability", () => {
  it("принимает три допустимых значения", () => {
    expect(isProductAvailability("in_stock")).toBe(true);
    expect(isProductAvailability("out_of_stock")).toBe(true);
    expect(isProductAvailability("unclear")).toBe(true);
  });

  it("отклоняет произвольную строку", () => {
    expect(isProductAvailability("available")).toBe(false);
    expect(isProductAvailability("")).toBe(false);
  });

  it("отклоняет отсутствующее значение", () => {
    expect(isProductAvailability(undefined)).toBe(false);
    expect(isProductAvailability(null)).toBe(false);
  });
});

describe("PRODUCT_AVAILABILITY_LABELS", () => {
  it("содержит подпись для каждого допустимого значения", () => {
    for (const value of PRODUCT_AVAILABILITY_OPTIONS) {
      expect(PRODUCT_AVAILABILITY_LABELS[value]).toBeTruthy();
    }
  });
});

describe("DEFAULT_PRODUCT_AVAILABILITY", () => {
  it("является допустимым значением", () => {
    expect(isProductAvailability(DEFAULT_PRODUCT_AVAILABILITY)).toBe(true);
  });
});
