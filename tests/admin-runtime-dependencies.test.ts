import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const requireEsmOptOutFlag = "--no-experimental-require-module";

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
  );
});
