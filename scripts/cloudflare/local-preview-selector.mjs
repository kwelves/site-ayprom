import { randomBytes } from "node:crypto";
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readAdminPreviewRuntime } from "./admin-preview-runtime.mjs";

const SELECTION_LIMIT_BYTES = 64 * 1024;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const defaultIo = { renameSync };
let io = defaultIo;

export function usePreviewSelectorIoForTests(next) {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}

export function previewSelectionStatus({ repoRoot }) {
  const file = selectionFile(repoRoot);
  if (pathProblem(file) === "symlink") return invalid("symlink");
  const state = readState(file);
  if (!state.ok) return state;
  if (state.missing) return { ok: true, generation: 0, current: null, previous: null };
  return { ok: true, generation: state.generation, current: state.current, previous: state.previous };
}

export function selectPreviewPackage({ repoRoot, packageName, expectedGeneration }) {
  const accepted = acceptPackage(repoRoot, packageName);
  if (!accepted.ok) return accepted;
  return updateSelection(repoRoot, expectedGeneration, (state) => {
    if (!state.missing && state.current === packageName) {
      return {
        ok: true,
        unchanged: true,
        state: { generation: state.generation, current: state.current, previous: state.previous },
      };
    }
    const generation = (state.missing ? 0 : state.generation) + 1;
    if (!Number.isSafeInteger(generation)) return { ok: false, code: "generation_overflow" };
    const next = { schemaVersion: 1, generation, current: packageName, previous: state.missing ? null : state.current };
    if (!validState(next)) return { ok: false, code: "selection_invalid", rule: "malformed" };
    return { ok: true, state: next };
  });
}

export function rollbackPreviewPackage({ repoRoot, expectedGeneration }) {
  return updateSelection(repoRoot, expectedGeneration, (state) => {
    if (state.missing || state.previous === null) return { ok: false, code: "previous_missing" };
    const accepted = acceptPackage(repoRoot, state.previous);
    if (!accepted.ok) return accepted;
    const generation = state.generation + 1;
    if (!Number.isSafeInteger(generation)) return { ok: false, code: "generation_overflow" };
    const next = { schemaVersion: 1, generation, current: state.previous, previous: state.current };
    if (!validState(next)) return { ok: false, code: "selection_invalid", rule: "malformed" };
    return { ok: true, state: next };
  });
}

export function runPreviewSelectorCli(args, hooks = {}) {
  const write = hooks.write ?? ((line) => process.stdout.write(line));
  const repoRoot = hooks.repoRoot ?? process.cwd();
  try {
    if (args.includes("--deploy")) return emit(write, { ok: false, code: "invalid_arguments" });
    const command = args[0];
    if (command === "status" && args.length === 1) return emit(write, previewSelectionStatus({ repoRoot }));
    const generation = readGenerationFlag(args);
    if (generation === null) return emit(write, { ok: false, code: "invalid_arguments" });
    if (command === "select" && args.length === 5 && args[1] === "--package" && args[3] === "--generation") {
      return emit(write, selectPreviewPackage({ repoRoot, packageName: args[2], expectedGeneration: generation }));
    }
    if (command === "rollback" && args.length === 3 && args[1] === "--generation") {
      return emit(write, rollbackPreviewPackage({ repoRoot, expectedGeneration: generation }));
    }
    return emit(write, { ok: false, code: "invalid_arguments" });
  } catch {
    return emit(write, { ok: false, code: "selection_write_failed" });
  }
}

function updateSelection(repoRoot, expectedGeneration, buildNext) {
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0) return { ok: false, code: "generation_mismatch" };
  const prepared = ensurePreviewDir(repoRoot);
  if (!prepared.ok) return prepared;
  const lock = acquireLock(prepared.dir);
  if (!lock.ok) return lock;
  let tmp = "";
  try {
    const state = readState(path.join(prepared.dir, "selection.json"));
    if (!state.ok) return state;
    const generation = state.missing ? 0 : state.generation;
    if (expectedGeneration !== generation) return { ok: false, code: "generation_mismatch" };
    const next = buildNext(state);
    if (!next.ok) return next;
    if (next.unchanged) {
      return { ok: true, generation: next.state.generation, current: next.state.current, previous: next.state.previous };
    }
    tmp = path.join(prepared.dir, `selection.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
    const fd = openSync(tmp, "wx");
    try {
      writeSync(fd, serialize(next.state));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    try {
      replaceInPlace(tmp, path.join(prepared.dir, "selection.json"));
    } catch {
      try { unlinkSync(tmp); } catch { /* temp leftover is not the selection */ }
      return { ok: false, code: "selection_write_failed" };
    }
    return { ok: true, generation: next.state.generation, current: next.state.current, previous: next.state.previous };
  } finally {
    releaseLock(lock);
  }
}

function acceptPackage(repoRoot, packageName) {
  if (typeof packageName !== "string" || !NAME.test(packageName)) return { ok: false, code: "package_rejected", rule: "invalid_name" };
  const root = path.resolve(repoRoot);
  const target = path.join(root, "dist", "worker-packages", packageName);
  if (path.relative(path.join(root, "dist", "worker-packages"), target) !== packageName) {
    return { ok: false, code: "package_rejected", rule: "invalid_name" };
  }
  if (pathProblem(target) === "symlink") return { ok: false, code: "package_rejected", rule: "symlink" };
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return { ok: false, code: "package_rejected", rule: "missing_package" };
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) return { ok: false, code: "package_rejected", rule: "symlink" };
  try {
    readAdminPreviewRuntime(target);
  } catch (error) {
    const rule = error instanceof Error && (error.message === "missing_inventory" || error.message === "package_integrity_failed" || error.message === "invalid_admin_preview")
      ? error.message
      : "invalid_admin_preview";
    return { ok: false, code: "package_rejected", rule };
  }
  return { ok: true };
}

function ensurePreviewDir(repoRoot) {
  const root = path.resolve(repoRoot);
  const dist = path.join(root, "dist");
  const dir = path.join(dist, "local-preview");
  if (pathProblem(dist) === "symlink" || pathProblem(dir) === "symlink") return invalid("symlink");
  let distStat;
  try {
    distStat = lstatSync(dist);
  } catch {
    return { ok: false, code: "selection_unavailable" };
  }
  if (distStat.isSymbolicLink() || !distStat.isDirectory()) return invalid("symlink");
  try {
    const dirStat = lstatSync(dir);
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) return invalid("symlink");
  } catch (error) {
    if (error?.code !== "ENOENT") return { ok: false, code: "selection_write_failed" };
    try {
      mkdirSync(dir);
    } catch {
      return { ok: false, code: "selection_write_failed" };
    }
  }
  return { ok: true, dir };
}

function readState(file) {
  if (pathProblem(file) === "symlink") return invalid("symlink");
  let stat;
  try {
    stat = lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return { ok: true, missing: true, generation: 0, current: null, previous: null };
    return invalid("read_failed");
  }
  if (stat.isSymbolicLink()) return invalid("symlink");
  if (!stat.isFile()) return invalid("malformed");
  if (stat.size > SELECTION_LIMIT_BYTES) return invalid("byte_limit");
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return invalid("malformed");
  }
  if (!validState(parsed)) return invalid("malformed");
  return { ok: true, missing: false, generation: parsed.generation, current: parsed.current, previous: parsed.previous };
}

function validState(value) {
  return Boolean(value)
    && value.schemaVersion === 1
    && Number.isSafeInteger(value.generation)
    && value.generation >= 1
    && typeof value.current === "string"
    && NAME.test(value.current)
    && (value.previous === null || (typeof value.previous === "string" && NAME.test(value.previous) && value.previous !== value.current));
}

function pathProblem(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  const parts = path.relative(cursor, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch {
      return index < parts.length - 1 ? "absent" : "absent";
    }
    if (stat.isSymbolicLink()) return "symlink";
  }
  return null;
}

function acquireLock(dir) {
  const lock = path.join(dir, "selection.lock");
  try {
    return { ok: true, fd: openSync(lock, "wx"), lock };
  } catch (error) {
    if (error?.code === "EEXIST") return { ok: false, code: "lock_held" };
    return { ok: false, code: "selection_write_failed" };
  }
}

function releaseLock(lock) {
  if (!lock.ok) return;
  try { closeSync(lock.fd); } catch { /* already closed */ }
  try { unlinkSync(lock.lock); } catch { /* a leftover lock stays held on purpose */ }
}

function serialize(state) {
  return `${JSON.stringify({ schemaVersion: 1, generation: state.generation, current: state.current, previous: state.previous })}\n`;
}

function replaceInPlace(tmp, dest) {
  io.renameSync(tmp, dest);
}

function selectionFile(repoRoot) {
  return path.join(path.resolve(repoRoot), "dist", "local-preview", "selection.json");
}

function invalid(rule) {
  return { ok: false, code: "selection_invalid", rule };
}

function readGenerationFlag(args) {
  const index = args.indexOf("--generation");
  if (index === -1 || !/^\d+$/.test(args[index + 1] ?? "")) return null;
  const value = Number(args[index + 1]);
  return Number.isSafeInteger(value) ? value : null;
}

function emit(write, result) {
  write(`${JSON.stringify(result)}\n`);
  return result.ok ? 0 : 1;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(path.resolve(entry)).href) {
  process.exitCode = runPreviewSelectorCli(process.argv.slice(2));
}
