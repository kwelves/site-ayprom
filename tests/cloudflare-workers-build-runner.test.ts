import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateStaticBuildPreflight } from "@/cloudflare/static-build/preflight";
import { loadLocalCatalogSnapshot } from "@/cloudflare/static-build/producer/local-snapshot";
import { runStaticProducer } from "@/cloudflare/static-build/producer/run";
import {
  createWorkersBuildChildEnv,
  resolveWorkersBuildBinding,
} from "@/cloudflare/static-build/producer/workers-build-config";
import { runWorkersBuild, type WorkersBuildRunnerInput } from "@/cloudflare/static-build/producer/workers-build-runner";
import { resolveStaticBuildSupabaseBindings } from "@/lib/supabase/static-build-bindings";
import { finalizeRevisionedBuild } from "../scripts/cloudflare/publication-revision-report.mjs";
import { packageWorkerAssets } from "../scripts/cloudflare/package-worker-assets-lib.mjs";
import {
  fixturePreflight,
  fixtureProducerInput,
  makeTempRepo,
  removeTempRepo,
  snapshotTree,
} from "./cloudflare-static-producer-support";

const worktree = path.resolve(".");
const script = path.join(worktree, "scripts/cloudflare/workers-build-runner.mjs");
const remoteOrigin = "https://catalog.example.test";
const publicKey = "sb_publishable_workers_build_fixture";
const serviceKey = `sb_secret_${"not_for_public_build"}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function anonJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ role })).toString("base64url");
  return `${header}.${payload}.signature`;
}

function publishedPackage(repoRoot: string): string {
  const directory = path.join(repoRoot, "dist", "worker-packages", "published");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "keep.txt"), "published-v1");
  return directory;
}

function runnerInput(repoRoot: string, overrides: Partial<WorkersBuildRunnerInput> = {}): WorkersBuildRunnerInput {
  const published = publishedPackage(repoRoot);
  return {
    repoRoot,
    publishedPackageDir: published,
    packageDir: path.join(repoRoot, "dist", "worker-packages", "next-build"),
    source: {
      mode: "workers-build",
      supabaseUrl: remoteOrigin,
      publishableKey: publicKey,
      allowlist: [remoteOrigin],
    },
    envFileNames: [] as string[],
    readRevision: async () => 4,
    buildStaticFiles: async () => true,
    crawlToStaging: async () => ({ ok: true, stagingDir: path.join(repoRoot, "dist", "staging", "run") }),
    finalize: ({ stagingDir, revision }: { stagingDir: string; revision: number }) => {
      finalizeRevisionedBuild({
        repoRoot,
        result: { ok: true, revision, stagingDir },
      });
    },
    packageStaging: async () => ({ ok: true, ready: true, productionReady: false }),
    ...overrides,
  };
}

describe("workers build binding", () => {
  it("accepts a remote public origin only in explicit build mode on the allowlist", () => {
    expect(resolveWorkersBuildBinding({
      mode: "workers-build",
      supabaseUrl: remoteOrigin,
      publishableKey: publicKey,
      allowlist: [remoteOrigin],
    })).toEqual({ ok: true, mode: "workers-build", url: remoteOrigin, key: publicKey });
    expect(resolveWorkersBuildBinding({
      mode: "workers-build",
      supabaseUrl: remoteOrigin,
      publishableKey: anonJwt("anon"),
      allowlist: [remoteOrigin],
    }).ok).toBe(true);
  });

  it("rejects a missing binding, a remote origin outside explicit build mode, and a non-allowlisted host", () => {
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: "", publishableKey: publicKey, allowlist: [remoteOrigin],
    })).toMatchObject({ ok: false, code: "binding_missing" });
    expect(resolveWorkersBuildBinding({
      mode: "loopback-fixture", supabaseUrl: remoteOrigin, publishableKey: publicKey, allowlist: [remoteOrigin],
    })).toMatchObject({ ok: false, code: "remote_requires_explicit_build_mode" });
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: remoteOrigin, publishableKey: publicKey, allowlist: ["https://other.example.test"],
    })).toMatchObject({ ok: false, code: "host_not_allowlisted" });
    expect(JSON.stringify(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: "http://catalog.example.test", publishableKey: publicKey, allowlist: [remoteOrigin],
    }))).not.toContain(publicKey);
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: "http://catalog.example.test", publishableKey: publicKey, allowlist: ["http://catalog.example.test"],
    })).toMatchObject({ ok: false, code: "allowlist_invalid" });
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: "https://user:secret@catalog.example.test", publishableKey: publicKey, allowlist: [remoteOrigin],
    })).toMatchObject({ ok: false, code: "binding_invalid" });
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: remoteOrigin, publishableKey: serviceKey, allowlist: [remoteOrigin],
    })).toMatchObject({ ok: false, code: "service_role_forbidden" });
    expect(resolveWorkersBuildBinding({
      mode: "workers-build", supabaseUrl: remoteOrigin, publishableKey: anonJwt("service_role"), allowlist: [remoteOrigin],
    })).toMatchObject({ ok: false, code: "service_role_forbidden" });
  });

  it("keeps the ordinary static build on loopback and accepts the remote key only with the build flag", () => {
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_STATIC_BUILD_SUPABASE_URL: remoteOrigin,
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey,
    })).toThrow("local_probe_invalid_binding");
    expect(resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_WORKERS_BUILD_MODE: "workers-build",
      AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: remoteOrigin,
      AYPROM_STATIC_BUILD_SUPABASE_URL: remoteOrigin,
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey,
    })).toEqual({ url: remoteOrigin, key: publicKey });
    expect(() => resolveStaticBuildSupabaseBindings({
      AYPROM_STATIC_BUILD: "1",
      AYPROM_WORKERS_BUILD_MODE: "workers-build",
      AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: remoteOrigin,
      AYPROM_STATIC_BUILD_SUPABASE_URL: remoteOrigin,
      AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY: serviceKey,
    })).toThrow("workers_build_binding_rejected");
  });

  it("gives the child process an allowlisted env and leaves service-role and the real key out of the browser binding", () => {
    const env = createWorkersBuildChildEnv({
      parent: {
        PATH: "C:\\Windows\\System32",
        SUPABASE_SERVICE_ROLE_KEY: "service-role-must-stay-out",
        CLOUDFLARE_API_TOKEN: "cf-token-must-stay-out",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
      },
      binding: { mode: "workers-build", url: remoteOrigin, key: publicKey },
      allowlist: [remoteOrigin],
      cacheNonce: "0123456789abcdef0123456789abcdef",
    });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    expect(env.CLOUDFLARE_API_TOKEN).toBeUndefined();
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toBe("https://static-build.invalid");
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe("sb_publishable_diagnostic_only");
    expect(env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY).toBe(publicKey);
    expect(env.AYPROM_WORKERS_BUILD_MODE).toBe("workers-build");
    expect(env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST).toBe(remoteOrigin);
    const loopback = createWorkersBuildChildEnv({
      parent: { PATH: "C:\\Windows\\System32" },
      binding: { mode: "loopback-fixture", url: "http://127.0.0.1:56421", key: publicKey },
      allowlist: [],
      cacheNonce: "0123456789abcdef0123456789abcdef",
    });
    expect(loopback.AYPROM_WORKERS_BUILD_MODE).toBeUndefined();
    expect(loopback.AYPROM_STATIC_BUILD_SUPABASE_URL).toBe("http://127.0.0.1:56421");
    const pinned = createWorkersBuildChildEnv({
      parent: { PATH: "C:\\Windows\\System32", ADMIN_SUPABASE_KEY: serviceKey,
        CATALOG_PUBLICATION_CAPABILITY: "private-capability-fixture" },
      binding: { mode: "loopback-fixture", url: "http://127.0.0.1:56421", key: publicKey },
      allowlist: [], cacheNonce: "0123456789abcdef0123456789abcdef",
      pinnedPublication: { path: "C:\\repo\\dist\\staging\\20261007T000000Z-aaaaaaaa\\meta\\catalog-publication-export.json",
        sha256: "a".repeat(64), releaseId: "20000000-0000-4000-8000-000000000001" },
    });
    expect(pinned.AYPROM_PUBLIC_CATALOG_READ_MODE).toBe("pinned");
    expect(pinned.AYPROM_PUBLIC_CATALOG_EXPORT_SHA256).toBe("a".repeat(64));
    expect(Object.values(pinned).join(" ")).not.toContain(serviceKey);
    expect(Object.values(pinned).join(" ")).not.toContain("private-capability-fixture");
  });

  it("hands the browser two optional public settings to the build, the Sentry address and the analytics token, and drops anything that does not look right", () => {
    const base = { binding: { mode: "workers-build" as const, url: remoteOrigin, key: publicKey }, allowlist: [remoteOrigin], cacheNonce: "0123456789abcdef0123456789abcdef" };
    const dsn = "https://0123456789abcdef0123456789abcdef@o123456.ingest.de.sentry.io/4511000000000001";
    const token = "0123456789abcdef0123456789abcdef";
    const given = createWorkersBuildChildEnv({ ...base, parent: { PATH: "x", NEXT_PUBLIC_SENTRY_DSN: dsn, NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: token } });
    expect(given.NEXT_PUBLIC_SENTRY_DSN).toBe(dsn);
    expect(given.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN).toBe(token);
    const absent = createWorkersBuildChildEnv({ ...base, parent: { PATH: "x" } });
    expect(absent).not.toHaveProperty("NEXT_PUBLIC_SENTRY_DSN");
    expect(absent).not.toHaveProperty("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN");
    // A malformed value must not stop a publication: it is left out and the site is built without it.
    const broken = createWorkersBuildChildEnv({ ...base, parent: { PATH: "x", NEXT_PUBLIC_SENTRY_DSN: "https://key@evil.example/1", NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: "not-a-token\"><script>" } });
    expect(broken).not.toHaveProperty("NEXT_PUBLIC_SENTRY_DSN");
    expect(broken).not.toHaveProperty("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN");
  });
});

describe("workers build runner", () => {
  it("packages a loopback fixture crawl into a new package and leaves the previous package unchanged", async () => {
    const repo = makeTempRepo();
    const published = publishedPackage(repo.repoRoot);
    const before = snapshotTree(published);
    const siteBefore = repo.siteSnapshot();
    const packageDir = path.join(repo.repoRoot, "dist", "worker-packages", "fixture-build");
    const fetches: string[] = [];
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetches.push(new URL(url).origin);
      if (new URL(url).hostname !== "127.0.0.1") throw new Error("external_fetch_forbidden");
      return originalFetch(input, init);
    }) as typeof fetch);
    try {
      const result = await runWorkersBuild({
        ...runnerInput(repo.repoRoot, {
          publishedPackageDir: published,
          packageDir,
          source: {
            mode: "loopback-fixture",
            supabaseUrl: "http://127.0.0.1:56421",
            publishableKey: publicKey,
            allowlist: [],
          },
        }),
        crawlToStaging: async () => {
          const crawled = await runStaticProducer(fixtureProducerInput(repo));
          if (!crawled.ok || !crawled.stagingDir) return { ok: false, stagingDir: crawled.stagingDir };
          const meta = path.join(crawled.stagingDir, "meta");
          const entryPath = path.join(meta, "alias-worker-entry.mjs");
          const worker = path.relative(meta, path.join(worktree, "src/cloudflare/worker.ts")).replaceAll("\\", "/");
          const aliases = path.relative(meta, path.join(worktree, "src/cloudflare/product-alias-redirects.ts")).replaceAll("\\", "/");
          const entry = readFileSync(entryPath, "utf8")
            .replace(/import baseWorker from .+;/, `import baseWorker from ${JSON.stringify(worker)};`)
            .replace(/import \{ createProductAliasRedirectHandler \} from .+;/, `import { createProductAliasRedirectHandler } from ${JSON.stringify(aliases)};`);
          writeFileSync(entryPath, entry);
          return { ok: true, stagingDir: crawled.stagingDir };
        },
        packageStaging: async ({ stagingDir }) => packageWorkerAssets({
          repoRoot: repo.repoRoot,
          stagingDir,
          packageDir,
          readCurrentRevision: async () => 4,
        }),
      });
      expect(result).toMatchObject({
        ok: true,
        code: null,
        stage: "packaged",
        productionReady: false,
        externalPublication: false,
        publishedPackageUnchanged: true,
        packageDir,
      });
      expect(snapshotTree(published)).toEqual(before);
      expect(repo.siteSnapshot()).toEqual(siteBefore);
      const manifest = JSON.parse(readFileSync(path.join(packageDir, "package-manifest.json"), "utf8"));
      expect(manifest.productionReady).toBe(false);
      expect(manifest.ready).toBe(true);
      expect(fetches.every((origin) => {
        const parsed = new URL(origin);
        return parsed.protocol === "http:" && parsed.hostname === "127.0.0.1";
      })).toBe(true);
      expect(fetches.some((origin) => origin.includes("cloudflare") || origin === remoteOrigin)).toBe(false);
      expect(JSON.stringify(result)).not.toContain(publicKey);
    } finally {
      removeTempRepo(repo.repoRoot);
    }
  }, 180_000);

  it("does not build when the binding or an env file is unacceptable", async () => {
    const repo = makeTempRepo();
    const events: string[] = [];
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network_forbidden"); }));
      const missing = await runWorkersBuild(runnerInput(repo.repoRoot, {
        source: { mode: "workers-build", supabaseUrl: "", publishableKey: publicKey, allowlist: [remoteOrigin] },
        buildStaticFiles: async () => { events.push("build"); return true; },
      }));
      const envFile = await runWorkersBuild(runnerInput(repo.repoRoot, {
        envFileNames: [".env.production"],
        buildStaticFiles: async () => { events.push("build"); return true; },
      }));
      expect(missing).toMatchObject({ ok: false, code: "binding_missing", stage: "preflight", productionReady: false, externalPublication: false, publishedPackageUnchanged: true, packageDir: null });
      expect(envFile).toMatchObject({ ok: false, code: "env_file_forbidden", stage: "preflight", packageDir: null });
      expect(events).toEqual([]);
      expect(snapshotTree(published)).toEqual(before);
      expect(JSON.stringify(envFile)).not.toContain(publicKey);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("stops on a revision change, a failed build, a failed crawl, or a failed package without replacing the published package", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      const packageCalls: string[] = [];
      const changed = [4, 5];
      const revision = await runWorkersBuild(runnerInput(repo.repoRoot, {
        readRevision: async () => changed.shift()!,
        crawlToStaging: async () => { packageCalls.push("crawl"); return { ok: true, stagingDir: "unexpected" }; },
        packageStaging: async () => { packageCalls.push("package"); return { ok: true, ready: true, productionReady: false }; },
      }));
      const built = await runWorkersBuild(runnerInput(repo.repoRoot, {
        buildStaticFiles: async () => { throw new Error(`build ${publicKey}`); },
        packageStaging: async () => { packageCalls.push("package"); return { ok: true, ready: true, productionReady: false }; },
      }));
      const crawled = await runWorkersBuild(runnerInput(repo.repoRoot, {
        crawlToStaging: async () => ({ ok: false, stagingDir: path.join(repo.repoRoot, "dist", "staging", "partial") }),
        packageStaging: async () => { packageCalls.push("package"); return { ok: true, ready: true, productionReady: false }; },
      }));
      const packaged = await runWorkersBuild(runnerInput(repo.repoRoot, {
        packageStaging: async () => { packageCalls.push("package"); return { ok: false, ready: false, productionReady: false, code: "worker_bundle_failed" }; },
      }));
      expect(revision).toMatchObject({ ok: false, code: "publication_revision_changed", stage: "after_build", packageDir: null, publishedPackageUnchanged: true });
      expect(built).toMatchObject({ ok: false, code: "static_build_failed", stage: "build", packageDir: null });
      expect(crawled).toMatchObject({ ok: false, code: "crawl_failed", stage: "crawl", packageDir: null });
      expect(packaged).toMatchObject({ ok: false, code: "package_failed", stage: "package", productionReady: false, externalPublication: false });
      expect(packageCalls).toEqual(["package"]);
      expect(snapshotTree(published)).toEqual(before);
      expect(JSON.stringify({ built, packaged })).not.toContain(publicKey);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("rejects a package that is not ready even when its packaging callback reports ok", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      const result = await runWorkersBuild(runnerInput(repo.repoRoot, {
        packageStaging: async () => ({ ok: true, ready: false, productionReady: false }),
      }));
      expect(result).toMatchObject({
        ok: false, code: "package_failed", stage: "package", packageDir: null,
        productionReady: false, externalPublication: false, publishedPackageUnchanged: true,
      });
      expect(snapshotTree(published)).toEqual(before);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("rejects a package when catalog content changes after packaging", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      const revisions = [4, 4, 4, 5];
      const result = await runWorkersBuild(runnerInput(repo.repoRoot, {
        readRevision: async () => revisions.shift()!,
        packageStaging: async () => ({ ok: true, ready: true, productionReady: false }),
      }));
      expect(result).toMatchObject({
        ok: false, code: "publication_revision_changed", stage: "after_package", packageDir: null,
        productionReady: false, externalPublication: false, publishedPackageUnchanged: true,
      });
      expect(snapshotTree(published)).toEqual(before);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("rejects a package when the final catalog revision cannot be read", async () => {
    const repo = makeTempRepo();
    try {
      const revisions = [4, 4, 4];
      const result = await runWorkersBuild(runnerInput(repo.repoRoot, {
        readRevision: async () => {
          const revision = revisions.shift();
          if (revision === undefined) throw new Error("catalog_unavailable");
          return revision;
        },
      }));
      expect(result).toMatchObject({
        ok: false, code: "publication_revision_unavailable", stage: "after_package",
        packageDir: null, productionReady: false, externalPublication: false,
      });
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("refuses a leaked key in staging or in the new package and does not keep that package", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      const staging = path.join(repo.repoRoot, "dist", "staging", "run");
      mkdirSync(path.join(staging, "meta"), { recursive: true });
      mkdirSync(path.join(staging, "site"), { recursive: true });
      writeFileSync(path.join(staging, "site", "index.html"), `<p>${publicKey}</p>`);
      const leakedStaging = await runWorkersBuild(runnerInput(repo.repoRoot, {
        crawlToStaging: async () => ({ ok: true, stagingDir: staging }),
        packageStaging: async () => { throw new Error("package_should_not_run"); },
      }));
      const packageDir = path.join(repo.repoRoot, "dist", "worker-packages", "leaky");
      const leakedPackage = await runWorkersBuild(runnerInput(repo.repoRoot, {
        packageDir,
        crawlToStaging: async () => ({ ok: true, stagingDir: path.join(repo.repoRoot, "dist", "staging", "clean") }),
        finalize: () => {},
        packageStaging: async ({ packageDir: output }) => {
          mkdirSync(output, { recursive: true });
          writeFileSync(path.join(output, "worker.js"), publicKey);
          return { ok: true, ready: true, productionReady: false };
        },
      }));
      expect(leakedStaging).toMatchObject({ ok: false, code: "secret_leak_forbidden", packageDir: null, publishedPackageUnchanged: true });
      expect(leakedPackage).toMatchObject({ ok: false, code: "secret_leak_forbidden", packageDir: null, externalPublication: false });
      expect(readFileSync(path.join(packageDir, "worker.js"), "utf8")).toBe(publicKey);
      expect(snapshotTree(published)).toEqual(before);
      expect(JSON.stringify({ leakedStaging, leakedPackage })).not.toContain(publicKey);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it("rejects an existing package directory before build, revision read, or packaging and keeps its sentinel", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const publishedBefore = snapshotTree(published);
      const siteBefore = repo.siteSnapshot();
      const packageDir = path.join(repo.repoRoot, "dist", "worker-packages", "already");
      mkdirSync(packageDir, { recursive: true });
      const sentinel = path.join(packageDir, "sentinel.txt");
      const sentinelBytes = Buffer.from("sentinel-v1");
      writeFileSync(sentinel, sentinelBytes);
      const events: string[] = [];
      const failures = [
        { readRevision: async () => { events.push("read"); throw new Error("revision down"); }, buildStaticFiles: async () => { events.push("build"); return true; }, packageStaging: async () => { events.push("package"); return { ok: true, ready: true, productionReady: false as const }; } },
        { readRevision: async () => { events.push("read"); return 4; }, buildStaticFiles: async () => { events.push("build"); throw new Error("build down"); }, packageStaging: async () => { events.push("package"); return { ok: true, ready: true, productionReady: false as const }; } },
        { readRevision: async () => { events.push("read"); return 4; }, buildStaticFiles: async () => { events.push("build"); return true; }, packageStaging: async () => { events.push("package"); return { ok: false, ready: false, productionReady: false as const }; } },
      ];
      for (const failure of failures) {
        const result = await runWorkersBuild(runnerInput(repo.repoRoot, { packageDir, ...failure }));
        expect(result).toMatchObject({
          ok: false, code: "package_path_rejected", stage: "preflight", packageDir: null,
          productionReady: false, externalPublication: false, publishedPackageUnchanged: true,
        });
      }
      expect(events).toEqual([]);
      expect(readFileSync(sentinel).equals(sentinelBytes)).toBe(true);
      expect(snapshotTree(published)).toEqual(publishedBefore);
      expect(repo.siteSnapshot()).toEqual(siteBefore);
    } finally {
      removeTempRepo(repo.repoRoot);
    }
  });

  it("rejects a junction or symlink on dist or worker-packages before any build step", async () => {
    const linkType = process.platform === "win32" ? "junction" : "dir";
    for (const linked of ["dist", "worker-packages"] as const) {
      const repo = makeTempRepo();
      const outside = mkdtempSync(path.join(os.tmpdir(), "ayprom-build-outside-"));
      const published = path.join(repo.repoRoot, "published-hold");
      mkdirSync(published, { recursive: true });
      writeFileSync(path.join(published, "keep.txt"), "published-v1");
      const publishedBefore = snapshotTree(published);
      const siteBefore = linked === "worker-packages" ? repo.siteSnapshot() : null;
      const link = linked === "dist"
        ? path.join(repo.repoRoot, "dist")
        : path.join(repo.repoRoot, "dist", "worker-packages");
      let linkedPath = "";
      try {
        rmSync(link, { recursive: true, force: true });
        symlinkSync(outside, link, linkType);
        linkedPath = link;
        const nested = linked === "dist" ? path.join(outside, "worker-packages", "already") : path.join(outside, "already");
        mkdirSync(nested, { recursive: true });
        const sentinel = path.join(nested, "sentinel.txt");
        const sentinelBytes = Buffer.from(`outside-${linked}`);
        writeFileSync(sentinel, sentinelBytes);
        const packageDir = path.join(repo.repoRoot, "dist", "worker-packages", "already");
        const events: string[] = [];
        const result = await runWorkersBuild(runnerInput(repo.repoRoot, {
          publishedPackageDir: published,
          packageDir,
          readRevision: async () => { events.push("read"); return 4; },
          buildStaticFiles: async () => { events.push("build"); return true; },
          packageStaging: async () => { events.push("package"); return { ok: false, ready: false, productionReady: false }; },
        }));
        expect(result).toMatchObject({
          ok: false, code: "package_path_rejected", stage: "preflight", packageDir: null, publishedPackageUnchanged: true,
        });
        expect(events).toEqual([]);
        expect(readFileSync(sentinel).equals(sentinelBytes)).toBe(true);
        expect(snapshotTree(published)).toEqual(publishedBefore);
        if (siteBefore) expect(repo.siteSnapshot()).toEqual(siteBefore);
      } finally {
        if (linkedPath) { try { unlinkSync(linkedPath); } catch { /* already gone */ } }
        rmSync(outside, { recursive: true, force: true });
        removeTempRepo(repo.repoRoot);
      }
    }
  });

  it("leaves the published package and sibling sentinels untouched when the build fails before a package exists", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const publishedBefore = snapshotTree(published);
      const siteBefore = repo.siteSnapshot();
      const sibling = path.join(repo.repoRoot, "dist", "worker-packages", "older");
      mkdirSync(sibling, { recursive: true });
      const sentinel = path.join(sibling, "sentinel.txt");
      const sentinelBytes = Buffer.from("older-package");
      writeFileSync(sentinel, sentinelBytes);
      const packageDir = path.join(repo.repoRoot, "dist", "worker-packages", "fresh");
      const events: string[] = [];
      const result = await runWorkersBuild(runnerInput(repo.repoRoot, {
        packageDir,
        readRevision: async () => { events.push("read"); throw new Error("revision down"); },
        buildStaticFiles: async () => { events.push("build"); return true; },
        packageStaging: async () => { events.push("package"); return { ok: false, productionReady: false }; },
      }));
      expect(result.ok).toBe(false);
      expect(result.packageDir).toBeNull();
      expect(result.publishedPackageUnchanged).toBe(true);
      expect(existsSync(packageDir)).toBe(false);
      expect(events).not.toContain("package");
      expect(readFileSync(sentinel).equals(sentinelBytes)).toBe(true);
      expect(snapshotTree(published)).toEqual(publishedBefore);
      expect(repo.siteSnapshot()).toEqual(siteBefore);
    } finally { removeTempRepo(repo.repoRoot); }
  });
});

describe("workers build command", () => {
  it("rejects local pinned capture against a remote catalog before touching a package", () => {
    const directory = makeTempRepo();
    const published = publishedPackage(directory.repoRoot);
    const before = snapshotTree(published);
    const packageDir = path.join(directory.repoRoot, "dist", "worker-packages", "not-created");
    try {
      const result = spawnSync(process.execPath, [script, "--local-pinned", "--published", published,
        "--package", packageDir], {
        cwd: worktree,
        env: { ...process.env, AYPROM_WORKERS_BUILD_MODE: "workers-build",
          AYPROM_WORKERS_BUILD_SUPABASE_URL: remoteOrigin,
          AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey,
          AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: remoteOrigin },
        encoding: "utf8", timeout: 15_000, windowsHide: true,
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: false,
        code: "local_pinned_requires_isolated_loopback", stage: "preflight",
        productionReady: false, externalPublication: false, publishedPackageUnchanged: true });
      expect(existsSync(packageDir)).toBe(false);
      expect(snapshotTree(published)).toEqual(before);
      expect(result.stdout + result.stderr).not.toContain(publicKey);
    } finally { removeTempRepo(directory.repoRoot); }
  });

  it("refuses a candidate when its sealed source changes during packaging", async () => {
    const repo = makeTempRepo();
    try {
      const published = publishedPackage(repo.repoRoot);
      const before = snapshotTree(published);
      let sealedSourceUnchanged = true;
      const input = runnerInput(repo.repoRoot, {
        packageStaging: async ({ packageDir }) => {
          mkdirSync(packageDir, { recursive: true });
          writeFileSync(path.join(packageDir, "candidate.txt"), "unpublished");
          sealedSourceUnchanged = false;
          return { ok: true, ready: true, productionReady: false };
        },
      });
      Object.assign(input, { verifySealedSource: async () => sealedSourceUnchanged });
      const result = await runWorkersBuild(input);
      expect(result).toMatchObject({ ok: false, code: "sealed_source_changed", stage: "after_package",
        packageDir: null, publishedPackageUnchanged: true, productionReady: false });
      expect(snapshotTree(published)).toEqual(before);
    } finally { removeTempRepo(repo.repoRoot); }
  });

  it.each([
    ["a loopback fixture binding", ["--staging-pinned"], { AYPROM_WORKERS_BUILD_MODE: "loopback-fixture",
      AYPROM_WORKERS_BUILD_SUPABASE_URL: "http://127.0.0.1:56421" }, "staging_pinned_requires_allowlisted_remote"],
    ["a remote origin missing from the allowlist", ["--staging-pinned"], { AYPROM_WORKERS_BUILD_MODE: "workers-build",
      AYPROM_WORKERS_BUILD_SUPABASE_URL: remoteOrigin, AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: "https://other.example.test" },
      "staging_pinned_requires_allowlisted_remote"],
    ["both pinned flags together", ["--local-pinned", "--staging-pinned"], { AYPROM_WORKERS_BUILD_MODE: "workers-build",
      AYPROM_WORKERS_BUILD_SUPABASE_URL: remoteOrigin, AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: remoteOrigin },
      "pinned_mode_conflict"],
  ])("rejects staging pinned capture with %s before touching a package", (_name, flags, binding, code) => {
    const directory = makeTempRepo();
    const published = publishedPackage(directory.repoRoot);
    const before = snapshotTree(published);
    const packageDir = path.join(directory.repoRoot, "dist", "worker-packages", "not-created");
    try {
      const result = spawnSync(process.execPath, [script, ...flags, "--published", published, "--package", packageDir], {
        cwd: worktree,
        env: { ...process.env, AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey, ADMIN_SUPABASE_KEY: serviceKey, ...binding },
        encoding: "utf8", timeout: 15_000, windowsHide: true,
      });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: false, code, stage: "preflight",
        productionReady: false, externalPublication: false, publishedPackageUnchanged: true });
      expect(existsSync(packageDir)).toBe(false);
      expect(snapshotTree(published)).toEqual(before);
      expect(result.stdout + result.stderr).not.toContain(publicKey);
      expect(result.stdout + result.stderr).not.toContain(serviceKey);
    } finally { removeTempRepo(directory.repoRoot); }
  });

  it("does not read NEXT_PUBLIC bindings, print the key, or publish when the explicit binding is wrong", () => {
    const directory = makeTempRepo();
    const published = publishedPackage(directory.repoRoot);
    const before = snapshotTree(published);
    const packageDir = path.join(directory.repoRoot, "dist", "worker-packages", "not-created");
    try {
      const result = spawnSync(process.execPath, [
        script,
        "--published", published,
        "--package", packageDir,
      ], {
        cwd: worktree,
        env: {
          ...process.env,
          NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
          AYPROM_WORKERS_BUILD_MODE: "workers-build",
          AYPROM_WORKERS_BUILD_SUPABASE_URL: "http://catalog.example.test",
          AYPROM_WORKERS_BUILD_SUPABASE_PUBLISHABLE_KEY: publicKey,
          AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST: "http://catalog.example.test",
        },
        encoding: "utf8",
        timeout: 15_000,
        windowsHide: true,
      });
      expect(result.status).toBe(1);
      const summary = JSON.parse(result.stdout.trim());
      expect(summary).toMatchObject({
        kind: "workers-build-runner",
        ok: false,
        code: "package_path_rejected",
        productionReady: false,
        externalPublication: false,
        publishedPackageUnchanged: true,
      });
      expect(result.stdout + result.stderr).not.toContain(publicKey);
      expect(result.stdout + result.stderr).not.toMatch(/api\.cloudflare\.com|versions upload|deploy hook/i);
      expect(existsSync(packageDir)).toBe(false);
      expect(snapshotTree(published)).toEqual(before);
    } finally { removeTempRepo(directory.repoRoot); }
  });
});

it("allows an allowlisted https catalog source in preflight and still rejects it without build mode", () => {
  const repo = makeTempRepo();
  try {
    const input = fixturePreflight(repo.repoRoot, repo.stagingRoot);
    input.sourceMode = "local-snapshot";
    input.env.AYPROM_WORKERS_BUILD_MODE = "workers-build";
    input.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST = remoteOrigin;
    input.env.AYPROM_STATIC_BUILD_SUPABASE_URL = remoteOrigin;
    input.env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY = publicKey;
    input.env.NEXT_PUBLIC_SUPABASE_URL = "https://static-build.invalid";
    input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_diagnostic_only";
    expect(validateStaticBuildPreflight(input).ok).toBe(true);
    delete input.env.AYPROM_WORKERS_BUILD_MODE;
    expect(validateStaticBuildPreflight(input)).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([{ field: "AYPROM_STATIC_BUILD_SUPABASE_URL", rule: "local_snapshot_requires_loopback" }]),
    });
  } finally { removeTempRepo(repo.repoRoot); }
});

it("does not call the network for a workers-build snapshot until the origin is allowlisted", async () => {
  const fetchImpl = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => {
    throw new Error("stop_before_network");
  });
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("unexpected_global_fetch"); }));
  await expect(loadLocalCatalogSnapshot({
    url: remoteOrigin,
    key: publicKey,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    acceptance: "workers-build",
    allowlist: ["https://other.example.test"],
  })).rejects.toThrow("host_not_allowlisted");
  expect(fetchImpl).not.toHaveBeenCalled();
  await expect(loadLocalCatalogSnapshot({
    url: remoteOrigin,
    key: publicKey,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    acceptance: "workers-build",
    allowlist: [remoteOrigin],
  })).rejects.toThrow("stop_before_network");
  expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(`${remoteOrigin}/rest/v1/`);
});
