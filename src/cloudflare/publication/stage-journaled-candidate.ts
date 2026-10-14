import { stageInactiveCandidate } from "./cloudflare-version-port";
import type { createReleaseJournal } from "./release-journal";

type StageInput = Parameters<typeof stageInactiveCandidate>[0];
type StageOutcome = Awaited<ReturnType<typeof stageInactiveCandidate>>;

/**
 * Safe Node entry point for inactive staging. A saved attempt is never blindly
 * uploaded again. Recovery of an existing version belongs to the coordinator,
 * not a retry of this function. No real remote adapter is selected here.
 */
export async function stageJournaledCandidate(input: Omit<StageInput, "journal"> & {
  journal: ReturnType<typeof createReleaseJournal>;
}): Promise<StageOutcome> {
  const unresolved: StageOutcome = { ok: false, status: "unresolved", productionReady: false };
  try {
    return await input.journal.exclusive(async () => {
      const history = await input.journal.read();
      const previous = history.filter((record) => record.releaseId === input.candidate.releaseId).at(-1);
      if (previous) {
        if (previous.releaseSha256 !== input.candidate.releaseSha256
          || previous.packageSha256 !== input.candidate.packageSha256
          || previous.revision !== input.candidate.revision) {
          return { ok: false, status: "rejected", productionReady: false };
        }
        if (["upload_started", "inactive_uploaded", "unresolved"].includes(previous.status)) return unresolved;
        return { ok: false, status: "rejected", productionReady: false };
      }
      return stageInactiveCandidate({ ...input, journal: async (entry) => { await input.journal.append(entry); } });
    });
  } catch { return unresolved; }
}
