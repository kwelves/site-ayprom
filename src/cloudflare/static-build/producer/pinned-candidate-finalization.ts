/** Recheck a local candidate after workerd/browser smoke; never publishes it. */
export async function verifyPinnedCandidateFinalState(input: {
  expectedRevision: number;
  readRevision: () => Promise<number>;
  verifySealedSource: () => Promise<boolean>;
  verifyPackage: () => boolean;
}): Promise<{ ok: true } | { ok: false; code: string }> {
  let revision: number;
  try { revision = await input.readRevision(); }
  catch { return { ok: false, code: "publication_revision_unavailable" }; }
  if (!Number.isSafeInteger(revision) || revision < 0) {
    return { ok: false, code: "publication_revision_unavailable" };
  }
  if (revision !== input.expectedRevision) {
    return { ok: false, code: "publication_revision_changed" };
  }
  try {
    if (!await input.verifySealedSource()) return { ok: false, code: "sealed_source_changed" };
  } catch { return { ok: false, code: "sealed_source_changed" }; }
  try {
    if (!input.verifyPackage()) return { ok: false, code: "package_integrity_failed" };
  } catch { return { ok: false, code: "package_integrity_failed" }; }
  return { ok: true };
}
