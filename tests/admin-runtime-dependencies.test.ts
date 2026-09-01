import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const requireEsmOptOutFlag = "--no-experimental-require-module";

/**
 * Проверка ниже синхронно поднимает отдельный процесс Node и грузит в нём
 * `isomorphic-dompurify` вместе со всем jsdom — в покое это ~600 мс, то есть
 * на порядок дороже обычного unit-теста, под который рассчитан дефолтный
 * лимит vitest в 5 с. При полном прогоне (86 файлов, воркеры конкурируют за
 * CPU и диск) те же 600 мс растягиваются за 5 с, и тест падал по таймауту,
 * хотя проверяемое поведение исправно — изолированно он проходит всегда.
 *
 * Поэтому лимит задан явно и по природе операции, а не оставлен дефолтным.
 * 30 с — это ~50× от замеренного времени: нагрузка столько не съест, а
 * настоящее зависание (например, если require начнёт ждать сеть) всё ещё
 * будет поймано, а не замаскировано.
 */
const SPAWN_AND_REQUIRE_TIMEOUT_MS = 30_000;

describe("admin runtime dependencies", () => {
  it("pins the server-side DOM implementation to the Vercel-compatible release", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      overrides?: Record<string, unknown>;
    };

    expect(packageJson.overrides?.["isomorphic-dompurify"]).toEqual({ jsdom: "25.0.1" });
  });

  it.skipIf(!process.allowedNodeEnvironmentFlags.has(requireEsmOptOutFlag))(
    "loads the SVG sanitizer when synchronous require(ESM) is unavailable",
    () => {
      const output = execFileSync(
        process.execPath,
        [
          requireEsmOptOutFlag,
          "-e",
          "const purifier=require('isomorphic-dompurify');process.stdout.write(typeof purifier.sanitize);process.exit(0)",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      expect(output).toBe("function");
    },
    SPAWN_AND_REQUIRE_TIMEOUT_MS,
  );
});
