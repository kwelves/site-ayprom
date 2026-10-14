import { inspectPublicationPackage } from "../../../scripts/cloudflare/publication-package-inspector.mjs";
import type { stageInactiveCandidate } from "./cloudflare-version-port";
import { createReleaseJournal } from "./release-journal";
import { stageJournaledCandidate } from "./stage-journaled-candidate";

type StageInput = Parameters<typeof stageInactiveCandidate>[0];
type StageOutcome = Awaited<ReturnType<typeof stageInactiveCandidate>>;

/** Node orchestration with the real, closed package inspector and durable history.
 * The caller supplies an independently expected candidate identity and preview probe.
 * Selecting/invoking a remote port is a separate, explicitly authorized execution gate.
 */
export async function stagePublicationPackage(input: Pick<StageInput, "candidate" | "cloudflare" | "probe"> & {
  journalPath: string;
}): Promise<StageOutcome> {
  try {
    return await stageJournaledCandidate({ candidate: input.candidate, cloudflare: input.cloudflare,
      probe: input.probe, inspectPackage: inspectPublicationPackage,
      journal: createReleaseJournal({ path: input.journalPath }) });
  } catch {
    return { ok: false, status: "unresolved", productionReady: false };
  }
}
