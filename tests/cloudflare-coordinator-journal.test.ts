import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createReleaseJournal, type ReleaseJournalInput } from "@/cloudflare/publication/release-journal";

const phases = ["ready_started","ready_verified","activation_started","activation_verified","pointer_started",
  "pointer_verified","live_verified","confirmation_started","rollback_started","rollback_verified","pointer_restore_started"] as const;
const context = {
  previousRelease: { releaseId:"30000000-0000-4000-8000-000000000001",revision:6,releaseSha256:"c".repeat(64) },
  previousDeploymentId:"deployment-old",
};
const base = {
  releaseId:"30000000-0000-4000-8000-000000000002",revision:7,releaseSha256:"b".repeat(64),packageSha256:"a".repeat(64),
  versionId:"version-new",previousVersionId:"version-old",deploymentId:"deployment-new",
};
async function withJournal(run: (journal: ReturnType<typeof createReleaseJournal>,file:string) => Promise<void>) {
  const directory = mkdtempSync(path.join(os.tmpdir(),"ayprom-coordinator-history-"));
  const file = path.join(directory,"release.jsonl");
  try { await run(createReleaseJournal({path:file}),file); }
  finally { rmSync(directory,{recursive:true,force:true}); }
}
describe("durable coordinator intent and previous release", () => {
  it.each(phases)("round-trips %s with the exact rollback identity", async (status) => {
    await withJournal(async (journal,file) => {
      await journal.append({...base,...context,status} as unknown as ReleaseJournalInput);
      expect(await journal.read()).toEqual([expect.objectContaining({...base,...context,status})]);
      expect(readFileSync(file,"utf8")).not.toContain("leaseToken");
    });
  });
  it("keeps existing staging histories readable and appends coordinator context", async () => {
    await withJournal(async (journal) => {
      await journal.append({...base,status:"inactive_verified"});
      await journal.append({...base,...context,status:"activation_started"} as unknown as ReleaseJournalInput);
      expect(await journal.read()).toHaveLength(2);
    });
  });
  it("rejects missing/partial/unsafe rollback context and never writes an intent", async () => {
    await withJournal(async (journal) => {
      const values = [
        {}, {previousRelease:context.previousRelease}, {previousDeploymentId:context.previousDeploymentId},
        {...context,previousRelease:{...context.previousRelease,releaseId:base.releaseId}},
        {...context,previousRelease:{...context.previousRelease,revision:-1}},
        {...context,previousRelease:{...context.previousRelease,leaseToken:"private-token"}},
        {...context,previousRelease:{...context.previousRelease,releaseSha256:"bad"}},
        {...context,previousDeploymentId:"https://secret.test"},
        {...context,previousVersionId:null}, {...context,versionId:null}, {...context,deploymentId:null},
        {...context,versionId:base.previousVersionId},
        {...context,previousRelease:{...context.previousRelease,revision:Number.MAX_SAFE_INTEGER+1}},
      ];
      for (const extra of values) await expect(journal.append({...base,status:"activation_started",...extra} as unknown as ReleaseJournalInput))
        .rejects.toThrow("release_journal_invalid");
      expect(await journal.read()).toEqual([]);
    });
  });
  it("persists the baseline before an upload has a version identifier", async () => {
    await withJournal(async (journal) => {
      await journal.append({...base,...context,status:"upload_started",versionId:null,
        deploymentId:context.previousDeploymentId} as unknown as ReleaseJournalInput);
      expect(await journal.read()).toEqual([expect.objectContaining({...context,status:"upload_started",versionId:null})]);
    });
  });
  it("validates optional context even for old status names", async () => {
    await withJournal(async (journal) => {
      await expect(journal.append({...base,status:"published",previousRelease:context.previousRelease} as unknown as ReleaseJournalInput))
        .rejects.toThrow("release_journal_invalid");
      await journal.append({...base,...context,status:"published"} as unknown as ReleaseJournalInput);
      expect(await journal.read()).toHaveLength(1);
    });
  });
  it("rejects corrupted previous identity on read and preserves the damaged file", async () => {
    await withJournal(async (journal,file) => {
      await journal.append({...base,...context,status:"activation_started"} as unknown as ReleaseJournalInput);
      const record = JSON.parse(readFileSync(file,"utf8"));
      record.previousRelease.revision = "6";
      const damaged = JSON.stringify(record)+"\n";
      writeFileSync(file,damaged);
      await expect(journal.read()).rejects.toThrow("release_journal_unavailable");
      await expect(journal.append({...base,status:"unresolved"})).rejects.toThrow("release_journal_unavailable");
      expect(readFileSync(file,"utf8")).toBe(damaged);
    });
  });
});
