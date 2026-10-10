// Local orchestration for a future Cloudflare Workers Build.
// It never deploys, uploads a version, calls a Deploy Hook, or talks to the
// Cloudflare API. A failed check leaves the previous package directory as it was.
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { runRevisionedStaticBuild } from "./revisioned-build";
import { resolveWorkersBuildBinding, type WorkersBuildBindingInput } from "./workers-build-config";

const FORBIDDEN_ENV_FILES = [".env", ".env.local", ".env.production", ".env.production.local"];
const SECRET_TEXT = /service_role|sb_secret_/i;

export interface WorkersBuildRunnerInput {
  repoRoot: string;
  publishedPackageDir: string;
  packageDir: string;
  source: WorkersBuildBindingInput;
  envFileNames: readonly string[];
  readRevision: () => Promise<number>;
  buildStaticFiles: () => Promise<boolean>;
  crawlToStaging: () => Promise<{ ok: boolean; stagingDir: string | null }>;
  finalize: (input: { stagingDir: string; revision: number }) => void;
  packageStaging: (input: { stagingDir: string; packageDir: string; revision: number }) => Promise<{
    ok: boolean;
    ready?: boolean;
    productionReady?: boolean;
    code?: string;
    packageDir?: string;
  }>;
  verifySealedSource?: (revision: number) => Promise<boolean>;
}

export interface WorkersBuildRunnerResult {
  ok: boolean;
  code: string | null;
  stage: string;
  stagingDir: string | null;
  packageDir: string | null;
  productionReady: false;
  externalPublication: false;
  publishedPackageUnchanged: boolean;
}

/** Run the revision fence, crawl, and package. The returned package is never production-ready. */
export async function runWorkersBuild(input: WorkersBuildRunnerInput): Promise<WorkersBuildRunnerResult> {
  const before = fingerprint(input.publishedPackageDir);
  const finish = (partial: {
    ok: boolean;
    code: string | null;
    stage: string;
    stagingDir: string | null;
    packageDir: string | null;
  }): WorkersBuildRunnerResult => ({
    ...partial,
    productionReady: false,
    externalPublication: false,
    publishedPackageUnchanged: fingerprint(input.publishedPackageDir) === before,
  });

  try {
    if (packageTargetRejected(input.repoRoot, input.packageDir, input.publishedPackageDir)) {
      return finish({ ok: false, code: "package_path_rejected", stage: "preflight", stagingDir: null, packageDir: null });
    }
    if (input.envFileNames.some((name) => FORBIDDEN_ENV_FILES.includes(name) || name.startsWith(".env"))) {
      return finish({ ok: false, code: "env_file_forbidden", stage: "preflight", stagingDir: null, packageDir: null });
    }
    const binding = resolveWorkersBuildBinding(input.source);
    if (!binding.ok) {
      return finish({ ok: false, code: binding.code, stage: "preflight", stagingDir: null, packageDir: null });
    }
    if (samePath(input.packageDir, input.publishedPackageDir)) {
      return finish({ ok: false, code: "package_path_rejected", stage: "preflight", stagingDir: null, packageDir: null });
    }

    const fenced = await runRevisionedStaticBuild({
      readRevision: input.readRevision,
      buildStaticFiles: input.buildStaticFiles,
      crawlToStaging: input.crawlToStaging,
    });
    if (!fenced.ok) {
      return finish({
        ok: false,
        code: fenced.code,
        stage: fenced.stage,
        stagingDir: fenced.stagingDir,
        packageDir: null,
      });
    }

    input.finalize({ stagingDir: fenced.stagingDir, revision: fenced.revision });
    if (containsSecret(fenced.stagingDir, binding.key)) {
      return finish({ ok: false, code: "secret_leak_forbidden", stage: "crawl", stagingDir: fenced.stagingDir, packageDir: null });
    }

    const packaged = await input.packageStaging({
      stagingDir: fenced.stagingDir,
      packageDir: input.packageDir,
      revision: fenced.revision,
    });
    if (!packaged.ok || packaged.ready !== true || packaged.productionReady !== false) {
      // A directory created by this attempt is left in place. rmSync after a
      // path check can still follow a junction swapped into the parent chain.
      return finish({ ok: false, code: "package_failed", stage: "package", stagingDir: fenced.stagingDir, packageDir: null });
    }
    if (containsSecret(input.packageDir, binding.key)) {
      return finish({ ok: false, code: "secret_leak_forbidden", stage: "package", stagingDir: fenced.stagingDir, packageDir: null });
    }
    let finalRevision: number;
    try {
      finalRevision = await input.readRevision();
    } catch {
      return finish({ ok: false, code: "publication_revision_unavailable", stage: "after_package", stagingDir: fenced.stagingDir, packageDir: null });
    }
    if (!Number.isSafeInteger(finalRevision) || finalRevision < 0) {
      return finish({ ok: false, code: "publication_revision_unavailable", stage: "after_package", stagingDir: fenced.stagingDir, packageDir: null });
    }
    if (finalRevision !== fenced.revision) {
      return finish({ ok: false, code: "publication_revision_changed", stage: "after_package", stagingDir: fenced.stagingDir, packageDir: null });
    }
    if (input.verifySealedSource) {
      let unchanged = false;
      try { unchanged = await input.verifySealedSource(fenced.revision); } catch { unchanged = false; }
      if (!unchanged) {
        return finish({ ok: false, code: "sealed_source_changed", stage: "after_package",
          stagingDir: fenced.stagingDir, packageDir: null });
      }
    }
    return finish({ ok: true, code: null, stage: "packaged", stagingDir: fenced.stagingDir, packageDir: input.packageDir });
  } catch {
    return finish({ ok: false, code: "workers_build_failed", stage: "preflight", stagingDir: null, packageDir: null });
  }
}

function fingerprint(root: string): string {
  if (!directoryExists(root)) return "missing";
  const files: string[] = [];
  const walk = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error("published_package_link");
      if (stat.isDirectory()) walk(absolute);
      else files.push(`${path.relative(root, absolute).replaceAll("\\", "/")}:${createHash("sha256").update(readFileSync(absolute)).digest("hex")}`);
    }
  };
  walk(root);
  return createHash("sha256").update(files.join("\n")).digest("hex");
}

function containsSecret(root: string, key: string): boolean {
  if (!directoryExists(root)) return false;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) return true;
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) stack.push(path.join(current, name));
      continue;
    }
    if (!stat.isFile() || stat.size > 2_000_000) continue;
    const text = readFileSync(current);
    if (key.length >= 8 && text.includes(key)) return true;
    if (SECRET_TEXT.test(text.toString("utf8"))) return true;
  }
  return false;
}

function packageTargetRejected(repoRoot: string, packageDir: string, publishedPackageDir: string): boolean {
  const repo = path.resolve(repoRoot);
  const dist = path.join(repo, "dist");
  const area = path.join(dist, "worker-packages");
  const site = path.join(dist, "site");
  const target = path.resolve(packageDir);
  const published = path.resolve(publishedPackageDir);
  if ([repo, dist, area, site, published].some((forbidden) => samePath(target, forbidden))) return true;
  const relative = path.relative(area, target);
  const name = relative.split(path.sep).filter(Boolean);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative) || name.length !== 1) return true;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name[0] ?? "")) return true;

  let realRepo = "";
  try { realRepo = realpathSync(repo); } catch { return true; }
  const chain = [repo, dist, area, target];
  for (const cursor of chain) {
    let stat;
    try { stat = lstatSync(cursor); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return true;
      if (samePath(cursor, repo) || samePath(cursor, dist)) return true;
      return samePath(cursor, area) ? targetExists(target) : false;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return true;
    if (samePath(cursor, target)) return true;
    let realCursor = "";
    try { realCursor = realpathSync(cursor); } catch { return true; }
    if (!isInside(realRepo, realCursor)) return true;
    if (directoryExists(site)) {
      try {
        const realSite = realpathSync(site);
        if (samePath(realCursor, realSite) || isInside(realSite, realCursor)) return true;
      } catch { return true; }
    }
  }
  return false;
}

function targetExists(target: string): boolean {
  try { return lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink(); }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ENOENT"; }
}

function directoryExists(target: string): boolean {
  try { return lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink(); }
  catch { return false; }
}

function isInside(parent: string, child: string): boolean {
  if (samePath(parent, child)) return true;
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
}
