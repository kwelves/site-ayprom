import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DURATION, EASE_UI, EASE_UI_IN_OUT } from "../src/lib/motion";

// Токены движения объявлены дважды: в @theme (src/app/globals.css) для
// Tailwind-утилит и в src/lib/motion.ts для Framer Motion, который не читает
// CSS-переменные. Тест держит две копии в согласии — иначе правка в одном
// месте молча разъедется со вторым, и одно и то же движение будет идти с
// разной скоростью в зависимости от того, кто его анимирует.
const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8");

function cssValue(name: string): string {
  const match = css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"));
  if (!match) throw new Error(`В globals.css нет токена ${name}`);
  return match[1].trim();
}

function cubicBezierPoints(value: string): number[] {
  const match = value.match(/^cubic-bezier\(([^)]+)\)$/);
  if (!match) throw new Error(`Ожидалась cubic-bezier, получено: ${value}`);
  return match[1].split(",").map((part) => Number(part.trim()));
}

describe("токены движения", () => {
  it.each(Object.entries(DURATION))("--transition-duration-%s совпадает с DURATION.%s", (name, seconds) => {
    expect(cssValue(`--transition-duration-${name}`)).toBe(`${Math.round(seconds * 1000)}ms`);
  });

  it("--ease-ui совпадает с EASE_UI", () => {
    expect(cubicBezierPoints(cssValue("--ease-ui"))).toEqual([...EASE_UI]);
  });

  it("--ease-ui-in-out совпадает с EASE_UI_IN_OUT", () => {
    expect(cubicBezierPoints(cssValue("--ease-ui-in-out"))).toEqual([...EASE_UI_IN_OUT]);
  });

  it("в TS нет длительностей сверх объявленных в CSS", () => {
    const declared = [...css.matchAll(/--transition-duration-([\w-]+):/g)].map((match) => match[1]).sort();
    expect(Object.keys(DURATION).sort()).toEqual(declared);
  });
});
