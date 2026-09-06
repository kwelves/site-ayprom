import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("local Supabase seed public assets", () => {
  it("не ссылается на удалённые файлы из public", () => {
    const seed = readFileSync(join(process.cwd(), "supabase", "seed.sql"), "utf8");
    const referencedPaths = [...seed.matchAll(/'\/(?!\/)([^']+\.(?:avif|gif|jpe?g|png|svg|webp))'/gi)].map(
      ([, pathname]) => pathname,
    );
    const missingPaths = [...new Set(referencedPaths)]
      .filter((pathname) => !existsSync(join(process.cwd(), "public", pathname)))
      .sort();

    expect(missingPaths).toEqual([]);
  });
});
