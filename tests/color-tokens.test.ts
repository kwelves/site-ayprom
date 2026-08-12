import { describe, expect, it } from "vitest";
import { findViolations, isAllowlisted } from "../scripts/check-color-tokens.mjs";

type Violation = { line: number; className: string; suggestion: string };

const found = (source: string, path = "src/components/ui/Sample.tsx"): Violation[] =>
  findViolations(source, path);

const classNames = (source: string, path?: string) =>
  found(source, path).map((violation) => violation.className);

describe("findViolations", () => {
  it("находит палитровый класс и предлагает токен", () => {
    const [violation] = found(`<div className="bg-primary hover:bg-blue-700" />`);

    expect(violation.className).toBe("hover:bg-blue-700");
    expect(violation.suggestion).toBe("hover:bg-primary-hover");
    expect(violation.line).toBe(1);
  });

  it("находит цвета в тернарниках и объектах-картах", () => {
    const source = [
      `const ACTION_STYLES = {`,
      `  INSERT: "bg-green-100 text-green-700",`,
      `};`,
      `const tone = isError ? "border-red-200" : "border-border";`,
    ].join("\n");

    expect(classNames(source)).toEqual([
      "bg-green-100",
      "text-green-700",
      "border-red-200",
    ]);
    expect(found(source)[2].line).toBe(4);
  });

  it("находит -white и -black с модификатором прозрачности", () => {
    expect(classNames(`<p className="text-white hover:bg-white/10" />`)).toEqual([
      "text-white",
      "hover:bg-white/10",
    ]);
  });

  it("находит произвольные цветовые значения", () => {
    expect(classNames(`<i className="bg-[#084bb9] text-[rgba(15,23,43,0.9)]" />`)).toEqual([
      "bg-[#084bb9]",
      "text-[rgba(15,23,43,0.9)]",
    ]);
  });

  it("находит направленные рамки и ring-offset", () => {
    expect(classNames(`<div className="border-t-slate-200 ring-offset-slate-900" />`)).toEqual([
      "border-t-slate-200",
      "ring-offset-slate-900",
    ]);
  });

  it("не трогает семантические токены", () => {
    const source = `<div className="bg-card text-muted-foreground border-input hover:bg-primary-hover ring-ring" />`;

    expect(found(source)).toEqual([]);
  });

  it("не считает нарушением rgba внутри тени", () => {
    expect(found(`<h2 className="drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]" />`)).toEqual([]);
  });

  it("не считает нарушением размерные утилиты с числами", () => {
    expect(found(`<div className="border-y-2 divide-y-4 text-3xl gap-blue" />`)).toEqual([]);
  });

  it("игнорирует блочные комментарии, не сбивая номера строк", () => {
    const source = ["/* было bg-blue-600 */", "", `<div className="text-red-600" />`].join("\n");
    const violations = found(source);

    expect(violations).toHaveLength(1);
    expect(violations[0].className).toBe("text-red-600");
    expect(violations[0].line).toBe(3);
  });

  it("для незнакомого класса даёт общую подсказку", () => {
    const [violation] = found(`<div className="bg-fuchsia-500" />`);

    expect(violation.suggestion).toContain("docs/design-tokens.md");
  });
});

describe("isAllowlisted", () => {
  it("разрешает объявление палитры и декоративную сцену", () => {
    expect(isAllowlisted("src/app/globals.css")).toBe(true);
    expect(isAllowlisted("src/components/home/vehicle-showcase/HotspotMarker.tsx")).toBe(true);
    expect(isAllowlisted("src/components/home/_archive/vehicle-showcase-v1/Card.tsx")).toBe(true);
  });

  it("не разрешает обычные компоненты", () => {
    expect(isAllowlisted("src/components/ui/Button.tsx")).toBe(false);
  });

  it("для файлов из allowlist нарушений не возвращает", () => {
    expect(found(`<i className="bg-[#084bb9]" />`, "src/components/home/vehicle-showcase/X.tsx")).toEqual([]);
  });
});
