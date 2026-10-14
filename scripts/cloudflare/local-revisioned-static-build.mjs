// Diagnostic-only full Next build and crawl with a public catalog revision fence.
// Never deploy, package for release, or promote dist/staging to dist/site.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { finalizeRevisionedBuild } from "./publication-revision-report.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(repo, "src") } });
const load = (name) => import(pathToFileURL(path.join(repo, "src/cloudflare/static-build", name)).href);
const { localProbeBindings } = await load("local-browser-probe.ts");
const { readPublicContentRevision } = await load("producer/publication-revision.ts");
const { runRevisionedStaticBuild } = await load("producer/revisioned-build.ts");

const kind = "local-revisioned-static-build";
const print = (value) => process.stdout.write(`${JSON.stringify({ kind, ...value })}\n`);
const childEnv = (bindings) => {
  const inherited = {};
  for (const key of ["PATH", "Path", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LANG", "LC_ALL"]) {
    if (process.env[key]) inherited[key] = process.env[key];
  }
  return {
    ...inherited,
    AYPROM_STATIC_BUILD: "1",
    AYPROM_STATIC_BUILD_SUPABASE_URL: bindings.SUPABASE_URL,
    AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY,
    AYPROM_STATIC_BUILD_CACHE_NONCE: randomBytes(16).toString("hex"),
    NEXT_PUBLIC_SUPABASE_URL: "https://static-build.invalid",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_diagnostic_only",
    NEXT_PUBLIC_SITE_URL: "https://www.ayprom-gidravlika.kg",
    NEXT_PUBLIC_MEDIA_BASE_URL: "https://media.ayprom-gidravlika.kg",
    NEXT_PUBLIC_HERO_MEDIA_SOURCE: "r2",
    NEXT_TELEMETRY_DISABLED: "1",
  };
};

function runNode(args, env, timeout) {
  return spawnSync(process.execPath, args, {
    cwd: repo, env, encoding: "utf8", windowsHide: true,
    timeout, maxBuffer: 2 * 1024 * 1024,
  });
}

async function main() {
  let bindings;
  try {
    bindings = localProbeBindings(
      process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
    );
  } catch {
    print({ ok: false, code: "local_probe_invalid_binding", stage: "preflight", stagingDir: null });
    process.exitCode = 1;
    return;
  }
  // Next reads these files even when the child environment is allowlisted.
  if ([".env", ".env.local", ".env.production", ".env.production.local"].some((name) => existsSync(path.join(repo, name)))) {
    print({ ok: false, code: "local_env_file_forbidden", stage: "preflight", stagingDir: null });
    process.exitCode = 1;
    return;
  }

  const env = childEnv(bindings);
  const result = await runRevisionedStaticBuild({
    readRevision: () => readPublicContentRevision({ url: bindings.SUPABASE_URL, key: bindings.SUPABASE_PUBLISHABLE_KEY }),
    buildStaticFiles: async () => {
      const build = runNode([path.join(repo, "node_modules/next/dist/bin/next"), "build"], env, 600_000);
      if (build.status !== 0 || build.error) {
        const diagnostic = `${build.stdout ?? ""}\n${build.stderr ?? ""}`
          .replaceAll(bindings.SUPABASE_PUBLISHABLE_KEY, "[public-key]")
          .replaceAll(bindings.SUPABASE_URL, "[local-api]")
          .slice(-4000);
        process.stderr.write(`${JSON.stringify({ stage: "next_build", diagnostic })}\n`);
      }
      return build.status === 0 && !build.error;
    },
    crawlToStaging: async () => {
      const crawl = runNode([path.join(repo, "scripts/cloudflare/local-static-producer.mjs")], {
        ...env,
        NEXT_PUBLIC_SUPABASE_URL: bindings.SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.SUPABASE_PUBLISHABLE_KEY,
      }, 700_000);
      let summary;
      try { summary = JSON.parse(crawl.stdout?.trim() ?? ""); } catch { summary = null; }
      return {
        ok: crawl.status === 0 && !crawl.error && summary?.kind === "local-full-crawl" && summary.ok === true,
        stagingDir: typeof summary?.stagingDir === "string" ? summary.stagingDir : null,
      };
    },
  });
  const completed = finalizeRevisionedBuild({ repoRoot: repo, result });
  print(completed);
  if (!completed.ok) process.exitCode = 1;
}

main().catch(() => {
  print({ ok: false, code: "local_revisioned_build_failed", stage: "preflight", stagingDir: null });
  process.exitCode = 1;
});
