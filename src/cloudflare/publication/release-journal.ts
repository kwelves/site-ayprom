import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readSync, unlinkSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]{1,128}$/;
const EVENT = /^[A-Za-z0-9_-]{1,128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const COORDINATOR_PHASES = ["ready_started", "ready_verified", "activation_started", "activation_verified",
  "pointer_started", "pointer_verified", "live_verified", "confirmation_started", "rollback_started",
  "rollback_verified", "pointer_restore_started"] as const;
const ADVANCED_STATUSES = new Set<string>(COORDINATOR_PHASES);
const STATUSES = new Set<string>([...COORDINATOR_PHASES, "candidate_created", "upload_started", "inactive_uploaded", "inactive_verified", "failed_old_live", "unresolved",
  "published", "rolled_back"]);
const REASONS = new Set(["upload_response_unknown", "preview_failed", "concurrent_deployment",
  "package_rejected", "activation_unknown", "journal_write_failed", "state_unavailable", "lease_lost",
  "concurrent_pointer", "ready_failed", "rollback_unknown", "pointer_unknown", "confirmation_unknown", "live_probe_failed", "media_missing"]);

export type ReleaseJournalStatus = "candidate_created" | "upload_started" | "inactive_uploaded" | "inactive_verified" | "failed_old_live"
  | "unresolved" | "published" | "rolled_back" | typeof COORDINATOR_PHASES[number];

export interface ReleaseJournalEntry {
  eventId: string;
  at: string;
  releaseId: string;
  status: ReleaseJournalStatus;
  revision: number;
  releaseSha256: string;
  packageSha256: string;
  versionId: string | null;
  previousVersionId: string | null;
  deploymentId: string | null;
  reasonCode?: string;
  /** Both fields are required together. Legacy staging records may omit both. */
  previousRelease?: { releaseId: string; revision: number; releaseSha256: string };
  previousDeploymentId?: string;
}

export type ReleaseJournalInput = Omit<ReleaseJournalEntry, "eventId" | "at">;

export function createReleaseJournal(input: {
  path: string;
  now?: () => string;
  id?: () => string;
}) {
  const file = resolveJournalPath(input.path);
  const now = input.now ?? (() => new Date().toISOString());
  const id = input.id ?? randomUUID;
  return {
    /** Separate from the per-append lock: held through the whole async operation. */
    async exclusive<T>(operation: () => Promise<T>): Promise<T> {
      let lock: number | undefined;
      try {
        assertJournalPath(file, true);
        lock = openSync(`${file}.operation.lock`, "wx", 0o600);
        return await operation();
      } catch { throw new Error("release_journal_unavailable"); }
      finally {
        if (lock !== undefined) {
          try { closeSync(lock); unlinkSync(`${file}.operation.lock`); }
          catch { throw new Error("release_journal_unavailable"); }
        }
      }
    },
    async append(entry: ReleaseJournalInput): Promise<ReleaseJournalEntry> {
      const record = { ...entry, eventId: id(), at: now() };
      if (!validRecord(record)) throw new Error("release_journal_invalid");
      let lock: number | undefined;
      try {
        assertJournalPath(file, true);
        // Fail closed on another writer (or an orphaned lock). Never steal a lock.
        lock = openSync(`${file}.lock`, "wx", 0o600);
        const history = readHistory(file);
        const line = Buffer.from(`${JSON.stringify(record)}\n`, "utf8");
        if (history.records.length >= MAX_RECORDS || history.bytes + line.length > MAX_BYTES
          || history.records.some((old) => old.eventId === record.eventId)) throw new Error("bad_history");
        assertJournalPath(file, false);
        const fd = openSync(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT
          | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          const stat = fstatSync(fd);
          if (!stat.isFile() || stat.size !== history.bytes) throw new Error("changed_history");
          let offset = 0;
          while (offset < line.length) {
            const written = writeSync(fd, line, offset, line.length - offset);
            if (written === 0) throw new Error("write_failed");
            offset += written;
          }
          fsyncSync(fd);
        } finally { closeSync(fd); }
        return record;
      } catch { throw new Error("release_journal_unavailable"); }
      finally {
        if (lock !== undefined) {
          try { closeSync(lock); unlinkSync(`${file}.lock`); }
          catch { throw new Error("release_journal_unavailable"); }
        }
      }
    },
    async read(): Promise<ReleaseJournalEntry[]> {
      try {
        assertJournalPath(file, false);
        return readHistory(file).records;
      } catch { throw new Error("release_journal_unavailable"); }
    },
  };
}

function readHistory(file: string): { bytes: number; records: ReleaseJournalEntry[] } {
  const initial = maybeStat(file);
  if (!initial) return { bytes: 0, records: [] };
  if (initial.isSymbolicLink() || !initial.isFile() || initial.size > MAX_BYTES) throw new Error("bad_file");
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size !== initial.size || stat.size > MAX_BYTES) throw new Error("bad_file");
    // A file growing after fstat cannot cause an unbounded allocation or read.
    const buffer = Buffer.alloc(stat.size + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const n = readSync(fd, buffer, bytes, buffer.length - bytes, bytes);
      if (n === 0) break;
      bytes += n;
    }
    if (bytes !== stat.size || fstatSync(fd).size !== stat.size) throw new Error("changed_file");
    if (bytes === 0) return { bytes, records: [] };
    const content = buffer.subarray(0, bytes).toString("utf8");
    if (!content.endsWith("\n")) throw new Error("torn_record");
    const lines = content.slice(0, -1).split(/\r?\n/);
    if (lines.length > MAX_RECORDS) throw new Error("too_many");
    const records = lines.map((line) => JSON.parse(line) as unknown);
    if (!records.every(validRecord)) throw new Error("bad_record");
    if (new Set(records.map((record) => record.eventId)).size !== records.length) throw new Error("duplicate_event");
    return { bytes, records };
  } finally { closeSync(fd); }
}

function maybeStat(file: string) {
  try { return lstatSync(file); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function resolveJournalPath(value: string): string {
  if (typeof value !== "string" || !path.isAbsolute(value) || !value.toLowerCase().endsWith(".jsonl")) {
    throw new Error("release_journal_unavailable");
  }
  return path.resolve(value);
}

function assertJournalPath(file: string, createParent: boolean): void {
  const root = path.parse(file).root;
  const parts = path.relative(root, path.dirname(file)).split(path.sep).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (!maybeStat(cursor)) {
      if (!createParent) throw new Error("bad_parent");
      mkdirSync(cursor);
    }
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("bad_parent");
  }
  const stat = maybeStat(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("bad_file");
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validContext(item: Record<string, unknown>): boolean {
  const previous = item.previousRelease;
  if (!previous || typeof previous !== "object" || Array.isArray(previous)) return false;
  const release = previous as Record<string, unknown>;
  return Object.keys(release).sort().join(",") === "releaseId,releaseSha256,revision"
    && typeof release.releaseId === "string" && UUID.test(release.releaseId)
    && release.releaseId !== item.releaseId
    && Number.isSafeInteger(release.revision) && (release.revision as number) >= 0
    && typeof release.releaseSha256 === "string" && HASH.test(release.releaseSha256)
    && typeof item.previousDeploymentId === "string" && IDENTIFIER.test(item.previousDeploymentId)
    && typeof item.previousVersionId === "string" && IDENTIFIER.test(item.previousVersionId);
}

function validRecord(value: unknown): value is ReleaseJournalEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  const keys = Object.keys(item).sort().join(",");
  const expected = item.reasonCode === undefined
    ? "at,deploymentId,eventId,packageSha256,previousVersionId,releaseId,releaseSha256,revision,status,versionId"
    : "at,deploymentId,eventId,packageSha256,previousVersionId,reasonCode,releaseId,releaseSha256,revision,status,versionId";
  const contextPresent = Object.hasOwn(item, "previousRelease") || Object.hasOwn(item, "previousDeploymentId");
  const expectedKeys = expected.split(",");
  if (contextPresent) expectedKeys.push("previousRelease", "previousDeploymentId");
  // Validate format and necessary recovery identity, not the execution sequence.
  // The coordinator must reconcile actual hosting/database state on every resume.
  const advanced = typeof item.status === "string" && ADVANCED_STATUSES.has(item.status);
  return keys === expectedKeys.sort().join(",")
    && (!contextPresent || validContext(item))
    && (!advanced || (contextPresent && item.versionId !== null && item.deploymentId !== null
      && item.versionId !== item.previousVersionId))
    && typeof item.eventId === "string" && EVENT.test(item.eventId)
    && validDate(item.at) && typeof item.releaseId === "string"
    && UUID.test(item.releaseId) && typeof item.status === "string" && STATUSES.has(item.status)
    && Number.isSafeInteger(item.revision) && (item.revision as number) >= 0
    && typeof item.packageSha256 === "string" && HASH.test(item.packageSha256)
    && typeof item.releaseSha256 === "string" && HASH.test(item.releaseSha256)
    && (item.versionId === null || (typeof item.versionId === "string" && IDENTIFIER.test(item.versionId)))
    && (item.previousVersionId === null || (typeof item.previousVersionId === "string" && IDENTIFIER.test(item.previousVersionId)))
    && (item.deploymentId === null || (typeof item.deploymentId === "string" && IDENTIFIER.test(item.deploymentId)))
    && (item.reasonCode === undefined || (typeof item.reasonCode === "string" && REASONS.has(item.reasonCode)));
}
