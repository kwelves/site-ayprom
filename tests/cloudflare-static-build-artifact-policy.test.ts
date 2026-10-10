import { describe, expect, it } from "vitest";
import {
  STATIC_ASSET_MAX_COUNT,
  STATIC_ASSET_MAX_FILE_BYTES,
  STATIC_ASSET_WARNING_COUNT,
  validateArtifactPolicy,
  type ArtifactCandidate,
} from "@/cloudflare/static-build/artifact-policy";

const baseFiles = (): ArtifactCandidate[] => [
  { path: "index.html", size: 100, text: "<html>AYPROM</html>" },
  { path: "404.html", size: 80, text: "<meta name=robots content=noindex>" },
  { path: "_next/static/app.js", size: 40, text: "console.log('ok')" },
];

describe("static artifact policy", () => {
  it("summarizes a safe artifact", () => {
    expect(validateArtifactPolicy(baseFiles())).toEqual({
      ok: true,
      value: { fileCount: 3, totalBytes: 220, maxFileBytes: 100, warnings: [] },
    });
  });

  it.each([
    [".env", "forbidden_path"],
    [".env.local", "forbidden_path"],
    ["assets/app.js.map", "forbidden_path"],
    ["_worker.js", "forbidden_path"],
    ["src/private.ts", "forbidden_path"],
    ["node_modules/pkg/index.js", "forbidden_path"],
    ["docs/readme.MD", "forbidden_path"],
    ["route.segment.RSC", "forbidden_path"],
    ["route.meta", "forbidden_path"],
    ["videos/hero.mp4", "forbidden_path"],
    ["..\\secret.txt", "invalid_path"],
    ["assets/%2e%2e/secret.txt", "invalid_path"],
    ["assets/%5csecret.txt", "invalid_path"],
    ["assets/%2Fsecret.txt", "invalid_path"],
    ["assets/%252e%252e/secret.txt", "invalid_path"],
    ["assets/%25255csecret.txt", "invalid_path"],
    ["assets/NUL", "invalid_path"],
    ["assets/COM1.txt", "invalid_path"],
    ["assets/a:b.txt", "invalid_path"],
    ["assets/a|b.txt", "invalid_path"],
    ["assets/trailing.", "invalid_path"],
    ["/absolute.html", "invalid_path"],
    ["C:/drive.html", "invalid_path"],
    ["assets//app.js", "invalid_path"],
    ["assets/../app.js", "invalid_path"],
    ["assets/./app.js", "invalid_path"],
  ])("rejects forbidden or invalid path %s", (path, rule) => {
    expect(validateArtifactPolicy([...baseFiles(), { path, size: 1 }])).toMatchObject({
      ok: false,
      code: "artifact_policy_failed",
      issues: expect.arrayContaining([expect.objectContaining({ field: path, rule })]),
    });
  });

  it.each([
    "service_role",
    "SeRvIcE_RoLe",
    "sb_secret_example",
    "SUPABASE_SECRET_KEY",
    "ADMIN_PASSWORD",
    "ADMIN_SESSION_SECRET",
    "R2_SECRET_ACCESS_KEY",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://[::1]:3001",
    "/storage/v1/object/public/site-media/hero",
    "preview.vercel.app",
    "/_next/image",
  ])("rejects forbidden text marker without returning its value: %s", (marker) => {
    const result = validateArtifactPolicy([
      ...baseFiles(),
      { path: "catalog.html", size: marker.length, text: marker },
    ]);
    expect(result).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "catalog.html", rule: "forbidden_content" }]),
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("scans each text file independently", () => {
    expect(validateArtifactPolicy([
      { path: "a.html", size: 5, text: "servi" },
      { path: "b.html", size: 7, text: "ce_role" },
    ])).toMatchObject({ ok: true });
  });

  it("permits Next URL polyfill code that compares a hostname to localhost", () => {
    expect(validateArtifactPolicy([
      { path: "_next/static/chunks/polyfill.js", size: 60, text: 'if("localhost"===s.host&&(s.host=""),e)return' },
    ])).toMatchObject({ ok: true });
  });

  it("permits the optimizer route literal in a copied JS chunk", () => {
    expect(validateArtifactPolicy([
      { path: "_next/static/chunks/image.js", size: 30, text: 'const path="/_next/image";' },
    ])).toMatchObject({ ok: true });
  });

  it("rejects an encoded service-role JWT without exposing the token", () => {
    const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
    const token = `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
    const result = validateArtifactPolicy([{ path: "app.js", size: token.length, text: token }]);
    expect(result).toMatchObject({
      ok: false,
      issues: [{ field: "app.js", rule: "forbidden_content" }],
    });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it("rejects invalid sizes and a file above 25 MiB", () => {
    expect(validateArtifactPolicy([{ path: "large.webp", size: STATIC_ASSET_MAX_FILE_BYTES + 1 }])).toMatchObject({
      ok: false,
      issues: [{ field: "large.webp", rule: "file_too_large" }],
    });
    for (const size of [-1, Number.NaN, 1.5]) {
      expect(validateArtifactPolicy([{ path: "bad.webp", size }])).toMatchObject({
        ok: false,
        issues: [{ field: "bad.webp", rule: "invalid_size" }],
      });
    }
  });

  it("warns at 15,000 files and rejects 20,001 files", () => {
    const makeFiles = (count: number) => Array.from({ length: count }, (_, index) => ({
      path: `assets/${index}.txt`, size: 1,
    }));
    expect(validateArtifactPolicy(makeFiles(STATIC_ASSET_WARNING_COUNT))).toMatchObject({
      ok: true,
      value: { warnings: ["file_count_warning"] },
    });
    expect(validateArtifactPolicy(makeFiles(STATIC_ASSET_MAX_COUNT + 1))).toMatchObject({
      ok: false,
      issues: [{ field: "files", rule: "file_count_limit_exceeded" }],
    });
  });

  it("rejects exact and case-insensitive collisions", () => {
    expect(validateArtifactPolicy([
      { path: "catalog.html", size: 1 },
      { path: "catalog.html", size: 1 },
    ])).toMatchObject({
      ok: false,
      issues: [{ field: "catalog.html", rule: "duplicate_path" }],
    });
    expect(validateArtifactPolicy([
      { path: "Catalog.html", size: 1 },
      { path: "catalog.html", size: 1 },
    ])).toMatchObject({
      ok: false,
      issues: [{ field: "catalog.html", rule: "case_insensitive_collision" }],
    });
  });
});
