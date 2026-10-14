import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseJournal, type ReleaseJournalEntry } from "@/cloudflare/publication/release-journal";

const releaseId = "20000000-0000-4000-8000-000000000001";
const baseEntry: Omit<ReleaseJournalEntry, "eventId" | "at"> = {
  releaseId, status: "inactive_verified", revision: 7,
  releaseSha256: "b".repeat(64), packageSha256: "a".repeat(64),
  versionId: "version-new", previousVersionId: "version-old", deploymentId: null,
};

function temp() { return mkdtempSync(path.join(os.tmpdir(), "ayprom-release-journal-")); }

describe("release journal", () => {
  it("appends safe release state and reads it back deterministically", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const journal = createReleaseJournal({ path: file, now: () => "2026-10-07T15:00:00.000Z", id: () => "event-1" });
      const written = await journal.append(baseEntry);
      expect(written).toEqual({ ...baseEntry, eventId: "event-1", at: "2026-10-07T15:00:00.000Z" });
      expect(await journal.read()).toEqual([written]);
      expect(readFileSync(file, "utf8")).not.toContain("capability");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("allows explicit failure states without storing exception text or preview URL", async () => {
    const root = temp();
    try {
      const journal = createReleaseJournal({ path: path.join(root, "release.jsonl"), id: () => "event-2" });
      const written = await journal.append({ ...baseEntry, status: "unresolved", versionId: null,
        deploymentId: "deployment-old", reasonCode: "upload_response_unknown" });
      expect(written).toMatchObject({ status: "unresolved", reasonCode: "upload_response_unknown" });
      expect(JSON.stringify(written)).not.toContain("https://");
      expect(JSON.stringify(written)).not.toContain("private-token");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects malformed or oversized records before writing", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const journal = createReleaseJournal({ path: file, id: () => "event-3" });
      for (const value of [
        { ...baseEntry, releaseId: "bad" },
        { ...baseEntry, revision: -1 },
        { ...baseEntry, packageSha256: "bad" },
        { ...baseEntry, status: "unknown" as never },
        { ...baseEntry, deploymentId: "https://preview.example.test" },
      ]) await expect(journal.append(value)).rejects.toThrow("release_journal_invalid");
      expect(existsSync(file)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it.each(["not-json\n", "{}\n", "\n", "truncated"])("does not append to damaged history (%s)", async (content) => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      writeFileSync(file, content);
      await expect(createReleaseJournal({ path: file }).append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(file, "utf8")).toBe(content);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a valid but unterminated record and duplicate event ids", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const journal = createReleaseJournal({ path: file, id: () => "same-event" });
      await journal.append(baseEntry);
      const original = readFileSync(file, "utf8");
      await expect(journal.append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(file, "utf8")).toBe(original);
      writeFileSync(file, original.trimEnd());
      await expect(journal.read()).rejects.toThrow("release_journal_unavailable");
      await expect(journal.append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      writeFileSync(file, original + original);
      await expect(journal.read()).rejects.toThrow("release_journal_unavailable");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("enforces the record count before append without changing history", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const at = "2026-10-07T15:00:00.000Z";
      const content = Array.from({ length: 10_000 }, (_, i) => JSON.stringify({ ...baseEntry, at, eventId: `event-${i}` }) + "\n").join("");
      writeFileSync(file, content);
      const journal = createReleaseJournal({ path: file });
      expect(await journal.read()).toHaveLength(10_000);
      await expect(journal.append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(file, "utf8")).toBe(content);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("enforces the byte limit before append", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const content = " ".repeat(8 * 1024 * 1024 + 1);
      writeFileSync(file, content);
      await expect(createReleaseJournal({ path: file }).append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(file, "utf8")).toBe(content);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not steal another process lock and releases its own lock", async () => {
    const root = temp();
    try {
      const file = path.join(root, "release.jsonl");
      const lock = `${file}.lock`;
      writeFileSync(lock, "foreign-owner");
      const journal = createReleaseJournal({ path: file });
      await expect(journal.append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(lock, "utf8")).toBe("foreign-owner");
      expect(existsSync(file)).toBe(false);
      rmSync(lock);
      await journal.append(baseEntry);
      expect(existsSync(lock)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("always rejects secret-like fields, independently of symlink support", async () => {
    const root = temp();
    try {
      const file = path.join(root, "secret.jsonl");
      const journal = createReleaseJournal({ path: file, now: () => "2026-02-31T15:00:00.000Z" });
      await expect(journal.append(baseEntry)).rejects.toThrow("release_journal_invalid");
      await expect(createReleaseJournal({ path: file }).append({ ...baseEntry, reasonCode: "private-token" }))
        .rejects.toThrow("release_journal_invalid");
      expect(existsSync(file)).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed on malformed existing content, symlink path, and secret-like fields", async () => {
    const root = temp();
    try {
      const malformed = path.join(root, "malformed.jsonl");
      writeFileSync(malformed, "not-json\n");
      await expect(createReleaseJournal({ path: malformed }).read()).rejects.toThrow("release_journal_unavailable");
      const target = path.join(root, "target.jsonl");
      writeFileSync(target, "");
      const alias = path.join(root, "alias.jsonl");
      try { symlinkSync(target, alias, "file"); } catch { return; }
      await expect(createReleaseJournal({ path: alias }).append(baseEntry)).rejects.toThrow("release_journal_unavailable");
      const outside = temp();
      const parentAlias = path.join(root, "parent-alias");
      try { symlinkSync(outside, parentAlias, "junction"); } catch { rmSync(outside, { recursive: true, force: true }); return; }
      await expect(createReleaseJournal({ path: path.join(parentAlias, "release.jsonl") }).append(baseEntry))
        .rejects.toThrow("release_journal_unavailable");
      rmSync(outside, { recursive: true, force: true });
      await expect(createReleaseJournal({ path: path.join(root, "secret.jsonl") }).append({
        ...baseEntry, reasonCode: "private-token" as never,
      })).rejects.toThrow("release_journal_invalid");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
