// What the admin Worker of each site needs: its own Worker name, database, media bucket, GitHub environment, variables
// and secrets. Pure data and checks (no network, no files), used by admin-deploy.mjs so that a production deployment can
// only be assembled from a complete, plausible set of settings and only with an explicit confirmation.
export const ADMIN_TARGETS = Object.freeze({
  staging: Object.freeze({
    workerName: "ayprom-admin-staging",
    supabaseUrl: "https://jpmoxtqafgbqihvjhvri.supabase.co",
    publishableKey: "sb_publishable_yxS4_LQqsdPRtWxxUgg8-g_jQdYsJci", // public by design
    mediaBaseUrl: "https://media.ayprom-gidravlika.kg",
    siteUrl: undefined,
    workflowRef: "cloudflare-integration-publish", // until the integration is merged into main
    workflowEnvironment: "staging",
    r2: undefined, // staging writes media to the database's own storage
    confirmation: undefined,
  }),
  production: Object.freeze({
    workerName: "ayprom-admin",
    supabaseUrl: "https://acyoyvetcyqmwppfenau.supabase.co",
    publishableKey: undefined, // read from the project and passed in
    mediaBaseUrl: "https://media.ayprom-gidravlika.kg",
    siteUrl: "https://www.ayprom-gidravlika.kg",
    workflowRef: "main",
    workflowEnvironment: "production",
    r2: Object.freeze({ bucket: "ayprom-media-production", journalBucket: "media-migration-journal" }),
    confirmation: "deploy-production-acyoyvetcyqmwppfenau",
  }),
});

const SHARED = Object.freeze({
  repository: "kwelves/site-ayprom",
  photoWorkflow: "photo-queue.yml",
  publicationWorkflow: "publish-site.yml",
});

const SECRET_RULES = {
  SUPABASE_SECRET_KEY: (value) => value.length >= 32,
  ADMIN_SESSION_SECRET: (value) => value.length >= 32,
  ADMIN_PASSWORD: (value) => value.length >= 12,
  GITHUB_DISPATCH_TOKEN: (value) => value.length >= 20,
  R2_ACCOUNT_ID: (value) => /^[a-f0-9]{32}$/.test(value),
  R2_ACCESS_KEY_ID: (value) => value.length >= 16,
  R2_SECRET_ACCESS_KEY: (value) => value.length >= 24,
};

/**
 * @param {{ target: string, secrets: Record<string, string | undefined>, publishableKey?: string,
 *   dualWriteSupabase?: string, confirm?: string }} input
 * @returns {{ workerName: string, vars: Record<string, string>, secrets: Record<string, string> }}
 */
export function buildAdminDeployment(input) {
  if (!Object.hasOwn(ADMIN_TARGETS, input.target)) throw new Error("unknown target: use staging or production");
  const target = ADMIN_TARGETS[input.target];
  if (target.confirmation && input.confirm !== target.confirmation) {
    throw new Error(`deploying to ${input.target} needs the confirmation ${target.confirmation}`);
  }

  const required = ["SUPABASE_SECRET_KEY", "ADMIN_SESSION_SECRET", "ADMIN_PASSWORD",
    ...(target.r2 ? ["GITHUB_DISPATCH_TOKEN", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] : [])];
  const optional = target.r2 ? [] : ["GITHUB_DISPATCH_TOKEN"];
  const secrets = {};
  for (const name of required) {
    const value = input.secrets?.[name]?.trim();
    if (!value || !SECRET_RULES[name](value)) throw new Error(`${name} is missing or not plausible`);
    secrets[name] = value;
  }
  for (const name of optional) {
    const value = input.secrets?.[name]?.trim();
    if (value) {
      if (!SECRET_RULES[name](value)) throw new Error(`${name} is not plausible`);
      secrets[name] = value;
    }
  }

  const publishableKey = target.publishableKey ?? input.publishableKey;
  if (!publishableKey || !/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(publishableKey)) {
    throw new Error("a publishable (public) database key is required; a secret key is never accepted here");
  }
  if (target.r2 && input.dualWriteSupabase !== "true" && input.dualWriteSupabase !== "false") {
    throw new Error("the dual-write decision (true or false) must be given: copy it from the current production setting");
  }

  const vars = {
    NEXT_PUBLIC_SUPABASE_URL: target.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_MEDIA_BASE_URL: target.mediaBaseUrl,
    ...(target.siteUrl ? { NEXT_PUBLIC_SITE_URL: target.siteUrl } : {}),
    NODE_ENV: "production",
    // Photos are processed in the background by the photo worker; this Worker only wakes it up.
    PHOTO_PROCESSING: "queue",
    GITHUB_REPOSITORY: SHARED.repository,
    PHOTO_WORKFLOW_FILE: SHARED.photoWorkflow,
    PHOTO_WORKFLOW_REF: target.workflowRef,
    // Edits wake the publication worker, which builds the public snapshot; the badge in the admin shows its state.
    PUBLICATION_WORKFLOW_FILE: SHARED.publicationWorkflow,
    PUBLICATION_WORKFLOW_REF: target.workflowRef,
    // The workflows run in the GitHub environment of this site (its own secrets).
    WORKFLOW_ENVIRONMENT: target.workflowEnvironment,
    ...(target.r2 ? {
      MEDIA_STORAGE_WRITE_TARGET: "r2",
      MEDIA_STORAGE_JOURNAL_BUCKET: target.r2.journalBucket,
      MEDIA_STORAGE_DUAL_WRITE_SUPABASE: input.dualWriteSupabase,
      // Files are not deleted from storage when a record is removed, until a separate, explicit decision.
      MEDIA_STORAGE_RETAIN_OBJECTS: "true",
      R2_BUCKET_NAME: target.r2.bucket,
    } : {}),
  };
  return { workerName: target.workerName, vars, secrets };
}
