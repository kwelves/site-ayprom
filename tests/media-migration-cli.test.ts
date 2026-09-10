import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

function run(args: string[]) {
  return spawnSync(process.execPath, ["scripts/migrate-media-to-r2.mjs", ...args], {
    cwd: process.cwd(), encoding: "utf8", timeout: 10000,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_SECRET_KEY: "test-only", R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_NAME: "test-bucket" },
  });
}

describe("migration CLI safety gates (no remote writes)", () => {
  it("can start and print help with the installed Node runtime", () => {
    const result = run(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("inventory only");
  });
  it("rejects a wrong project before any data access", () => {
    const result = run(["--apply", "--confirm-project-ref=wrong"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Подтверждение проекта");
  });
  it("blocks switching until editing pause and backup are confirmed", () => {
    const result = run(["--apply", "--confirm-project-ref=test-project"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--editing-paused");
  });
  it("refuses to write a journal inside the repository", () => {
    const result = run([`--journal=${path.join(process.cwd(), "migration.jsonl")}`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Журнал нельзя сохранять в репозитории");
  });
});
