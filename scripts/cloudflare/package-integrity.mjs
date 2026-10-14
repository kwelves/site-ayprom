import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_DIRECTORIES = 20_000;
const MAX_DEPTH = 32;
export const METADATA_READ_LIMIT_BYTES = 25 * 1024 * 1024;
export const PACKAGE_INTEGRITY_LIMITS = {
  maxFiles: MAX_FILES,
  maxFileBytes: MAX_FILE_BYTES,
  maxMetadataBytes: METADATA_READ_LIMIT_BYTES,
  maxTotalBytes: MAX_TOTAL_BYTES,
  maxDirectories: MAX_DIRECTORIES,
  maxDepth: MAX_DEPTH,
};

const DEVICE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const defaultIo = { lstatSync, readdirSync, readFileSync };
let io = defaultIo;

export function useIntegrityIoForTests(next) {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}

export function gateInventoryList(files) {
  if (!Array.isArray(files)) return fail("missing_inventory");
  if (files.length > MAX_FILES) return fail("file_limit");
  return null;
}

export function readBoundedTextFile(absolutePath) {
  try {
    const stat = io.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) return fail("symlink");
    if (!stat.isFile()) return fail("read_failed");
    if (stat.size > METADATA_READ_LIMIT_BYTES) return fail("byte_limit");
    return { ok: true, text: io.readFileSync(absolutePath, "utf8") };
  } catch {
    return fail("read_failed");
  }
}

export function collectPackageInventory(packageDir) {
  try {
    const walked = walkPackage(packageDir);
    if (!walked.ok) return walked;
    return { ok: true, inventory: { files: hashFiles(walked.files) } };
  } catch {
    return fail("read_failed");
  }
}

export function verifyPackageIntegrity(packageDir) {
  try {
    const walked = walkPackage(packageDir);
    if (!walked.ok) return walked;
    const manifestFile = readBoundedTextFile(path.join(path.resolve(packageDir), "package-manifest.json"));
    if (!manifestFile.ok) return manifestFile.rule === "byte_limit" || manifestFile.rule === "symlink" ? manifestFile : fail("missing_inventory");
    const manifest = JSON.parse(manifestFile.text);
    const gate = gateInventoryList(manifest?.inventory?.files);
    if (gate) return gate;
    const listed = manifest.inventory.files;
    const checked = checkListedPaths(listed);
    if (!checked.ok) return checked;
    const expected = new Map(listed.map((file) => [file.path, file]));
    const actual = new Set(walked.files.map((file) => file.path));
    if ([...actual].some((filePath) => !expected.has(filePath))) return fail("extra_file");
    if ([...expected.keys()].some((filePath) => !actual.has(filePath))) return fail("missing_file");
    if (!listed.some((file) => file.path.startsWith("site/")) || !walked.files.some((file) => file.path.startsWith("site/"))) {
      return fail("empty_site");
    }
    for (const file of walked.files) {
      const item = expected.get(file.path);
      if (!Number.isSafeInteger(item.bytes) || item.bytes !== file.bytes) return fail("changed_file");
      const hashed = hashOne(file.absolute);
      if (hashed.bytes !== item.bytes || hashed.sha256 !== item.sha256) return fail("changed_file");
    }
    return { ok: true };
  } catch {
    return fail("read_failed");
  }
}

function walkPackage(packageDir) {
  const root = path.resolve(packageDir);
  if (linkedAncestor(root)) return fail("symlink");
  let stat;
  try {
    stat = io.lstatSync(root);
  } catch {
    return fail("missing_inventory");
  }
  if (stat.isSymbolicLink()) return fail("symlink");
  if (!stat.isDirectory()) return fail("missing_inventory");
  const files = [];
  let total = 0;
  let directories = 0;
  const visit = (directory, depth) => {
    if (depth > MAX_DEPTH) return fail("depth_limit");
    directories += 1;
    if (directories > MAX_DIRECTORIES) return fail("directory_limit");
    for (const name of io.readdirSync(directory)) {
      if (DEVICE.test(name)) return fail("device_name");
      const absolute = path.join(directory, name);
      const item = io.lstatSync(absolute);
      if (item.isSymbolicLink()) return fail("symlink");
      if (item.isDirectory()) {
        const nested = visit(absolute, depth + 1);
        if (nested) return nested;
        continue;
      }
      if (!item.isFile()) return fail("symlink");
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      if (relative === "package-manifest.json") {
        if (item.size > METADATA_READ_LIMIT_BYTES) return fail("byte_limit");
        continue;
      }
      if (item.size > MAX_FILE_BYTES || total + item.size > MAX_TOTAL_BYTES) return fail("byte_limit");
      total += item.size;
      files.push({ path: relative, bytes: item.size, absolute });
      if (files.length > MAX_FILES) return fail("file_limit");
    }
    return null;
  };
  const problem = visit(root, 1);
  if (problem) return problem;
  files.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const folded = new Set();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (folded.has(key)) return fail("case_collision");
    folded.add(key);
  }
  return { ok: true, files };
}

function checkListedPaths(files) {
  const folded = new Set();
  for (const file of files) {
    if (!file || typeof file.path !== "string" || !portable(file.path)) {
      return fail(typeof file?.path === "string" && file.path.split("/").some((segment) => DEVICE.test(segment)) ? "device_name" : "unsafe_path");
    }
    const key = file.path.toLowerCase();
    if (folded.has(key)) return fail("case_collision");
    folded.add(key);
  }
  return { ok: true };
}

function portable(relativePath) {
  if (relativePath.includes("\\") || relativePath.startsWith("/") || relativePath.includes(":")) return false;
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || DEVICE.test(segment))) return false;
  return true;
}

function hashFiles(files) {
  return files.map((file) => ({ path: file.path, ...hashOne(file.absolute) }));
}

function hashOne(absolute) {
  const bytes = io.readFileSync(absolute);
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function linkedAncestor(target) {
  const absolute = path.resolve(target);
  let cursor = path.parse(absolute).root;
  const parts = path.relative(cursor, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try {
      stat = io.lstatSync(cursor);
    } catch {
      return index < parts.length - 1;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

function fail(rule) {
  return { ok: false, code: "package_integrity_failed", rule };
}
