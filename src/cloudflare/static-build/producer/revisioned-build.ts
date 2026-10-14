interface RevisionedStaticBuildInput {
  readRevision: () => Promise<number>;
  buildStaticFiles: () => Promise<boolean>;
  crawlToStaging: () => Promise<{ ok: boolean; stagingDir: string | null }>;
}

type BuildStage = "before_build" | "build" | "after_build" | "crawl" | "after_crawl";
type BuildCode = "publication_revision_unavailable" | "publication_revision_changed"
  | "static_build_failed" | "crawl_failed";
type RevisionedStaticBuildResult =
  | { ok: true; revision: number; stagingDir: string }
  | { ok: false; code: BuildCode; stage: BuildStage; stagingDir: string | null };

/** Diagnostic build and crawl only. Never publish or promote the returned staging directory. */
export async function runRevisionedStaticBuild(input: RevisionedStaticBuildInput): Promise<RevisionedStaticBuildResult> {
  const read = async (): Promise<number | null> => {
    try {
      const revision = await input.readRevision();
      return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
    } catch { return null; }
  };

  const revision = await read();
  if (revision === null) {
    return { ok: false, code: "publication_revision_unavailable", stage: "before_build", stagingDir: null };
  }
  try {
    if (!await input.buildStaticFiles()) {
      return { ok: false, code: "static_build_failed", stage: "build", stagingDir: null };
    }
  } catch {
    return { ok: false, code: "static_build_failed", stage: "build", stagingDir: null };
  }

  const afterBuild = await read();
  if (afterBuild === null) {
    return { ok: false, code: "publication_revision_unavailable", stage: "after_build", stagingDir: null };
  }
  if (afterBuild !== revision) {
    return { ok: false, code: "publication_revision_changed", stage: "after_build", stagingDir: null };
  }

  let stagingDir: string | null = null;
  try {
    const crawl = await input.crawlToStaging();
    stagingDir = crawl.stagingDir;
    if (!crawl.ok || !stagingDir) {
      return { ok: false, code: "crawl_failed", stage: "crawl", stagingDir };
    }
  } catch {
    return { ok: false, code: "crawl_failed", stage: "crawl", stagingDir };
  }

  const afterCrawl = await read();
  if (afterCrawl === null) {
    return { ok: false, code: "publication_revision_unavailable", stage: "after_crawl", stagingDir };
  }
  if (afterCrawl !== revision) {
    return { ok: false, code: "publication_revision_changed", stage: "after_crawl", stagingDir };
  }
  return { ok: true, revision, stagingDir };
}
