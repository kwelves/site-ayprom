import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// An entrance animation that keeps filling after it ends (fill-mode "both"/"forwards") on translate or scale makes
// its element the containing block of every position:fixed descendant. The admin screen wrapper did that once:
// the quick-view panel and confirm dialogs then stretched to the length of the whole page instead of the window.
// Admin entrances therefore fill only backwards (the start frame waits for a stagger delay, the end lets go).
const root = process.cwd();

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.(tsx|ts)$/.test(entry.name) ? [full] : [];
  });
}

describe("admin entrance animations", () => {
  it("never keep filling after they end", () => {
    const offenders: string[] = [];
    for (const file of [...files(path.join(root, "src/components/admin")), ...files(path.join(root, "src/app/admin"))]) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/animate-\[admin-[a-z-]+_[^\]]*_(both|forwards)\]/g)) {
        offenders.push(`${path.relative(root, file)}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("lets the screen wrapper go once it has come in", () => {
    const css = readFileSync(path.join(root, "src/app/globals.css"), "utf8");
    const rule = /\[data-admin-screen\]\s*\{\s*animation:([^;]+);/.exec(css)?.[1] ?? "";
    expect(rule).toContain("admin-screen-in");
    expect(rule).toMatch(/\bbackwards\b/);
    expect(rule).not.toMatch(/\b(both|forwards)\b/);
  });
});
