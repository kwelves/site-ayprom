import { inspectPublicationPackage } from "../../../scripts/cloudflare/publication-package-inspector.mjs";
import { publishCandidate, type PublicationOutcome, type PublishInput } from "./release-coordinator";
import { createReleaseJournal } from "./release-journal";

/** Real closed file inspection + durable journal. No remote port is selected here.
 * Remote activation and real probe authorization are separate execution gates.
 */
export async function publishPublicationPackage(input: Omit<PublishInput, "journal" | "inspectPackage"> & {
  journalPath: string;
}): Promise<PublicationOutcome> {
  try {
    return await publishCandidate({ ...input, inspectPackage: inspectPublicationPackage,
      journal: createReleaseJournal({ path: input.journalPath }) });
  } catch { return { ok: false, status: "unresolved", productionReady: false }; }
}
