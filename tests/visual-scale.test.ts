import { describe, expect, it } from "vitest";
import {
  MAX_VISUAL_SCALE,
  MIN_VISUAL_SCALE,
  normalizeVisualScale,
} from "@/lib/admin/visual-scale";

describe("normalizeVisualScale", () => {
  it("трактует пустое значение как отсутствие масштабирования", () => {
    expect(normalizeVisualScale(null)).toBeNull();
    expect(normalizeVisualScale(undefined)).toBeNull();
    expect(normalizeVisualScale("")).toBeNull();
    expect(normalizeVisualScale("   ")).toBeNull();
  });

  it("принимает значения внутри измеренного диапазона", () => {
    expect(normalizeVisualScale(1)).toBe(1);
    expect(normalizeVisualScale("1.6")).toBe(1.6);
    expect(normalizeVisualScale(0.75)).toBe(0.75);
  });

  it("принимает обе границы включительно", () => {
    expect(normalizeVisualScale(MIN_VISUAL_SCALE)).toBe(MIN_VISUAL_SCALE);
    expect(normalizeVisualScale(MAX_VISUAL_SCALE)).toBe(MAX_VISUAL_SCALE);
  });

  it("округляет до сотых, чтобы хранимое совпадало с введённым шагом", () => {
    expect(normalizeVisualScale(1.234)).toBe(1.23);
    expect(normalizeVisualScale(1.005)).toBe(1.0);
  });

  // Опечатка «100» вместо «1.00» — основной сценарий QA-012: раньше она молча
  // сохранялась и ломала вёрстку публичной страницы.
  it("отвергает значение выше максимума, а не обрезает его", () => {
    expect(() => normalizeVisualScale(100)).toThrow(/от 0\.1 до 5/);
    expect(() => normalizeVisualScale(MAX_VISUAL_SCALE + 0.01)).toThrow(/от 0\.1 до 5/);
  });

  it("отвергает ноль, отрицательные значения и значения ниже минимума", () => {
    expect(() => normalizeVisualScale(0)).toThrow(/от 0\.1 до 5/);
    expect(() => normalizeVisualScale(-1)).toThrow(/от 0\.1 до 5/);
    expect(() => normalizeVisualScale(MIN_VISUAL_SCALE - 0.01)).toThrow(/от 0\.1 до 5/);
  });

  // Прежде нечисловой ввод превращался в null: админ видел «сохранено», хотя
  // масштаб терялся.
  it("отвергает нечисловой ввод вместо тихой потери значения", () => {
    expect(() => normalizeVisualScale("abc")).toThrow(/числом/);
    expect(() => normalizeVisualScale(Number.NaN)).toThrow(/числом/);
    expect(() => normalizeVisualScale(Number.POSITIVE_INFINITY)).toThrow(/числом/);
  });
});
