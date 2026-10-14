// Where a publication may go. The publication worker turns the catalog of ONE database into a new version of ONE
// Cloudflare Worker; this module is the interlock that keeps the pairs together: staging data only to the staging
// Worker, production data only to the production Worker, and production only after a second, explicit confirmation.
// Pure data and checks: nothing here talks to the network.
export const TARGETS = Object.freeze({
  staging: Object.freeze({
    supabaseHost: "jpmoxtqafgbqihvjhvri.supabase.co",
    workerName: "ayprom-publication-staging",
    requiresConfirmation: false,
  }),
  production: Object.freeze({
    supabaseHost: "acyoyvetcyqmwppfenau.supabase.co",
    workerName: "ayprom-public",
    requiresConfirmation: true,
  }),
});

/** @param {Record<string, string | undefined>} env */
export function resolvePublicationTarget(env) {
  const name = env.PUBLICATION_TARGET?.trim();
  if (!name || !Object.hasOwn(TARGETS, name)) throw new Error("PUBLICATION_TARGET must be staging or production");
  const target = TARGETS[name];

  let url;
  try { url = new URL(env.SUPABASE_URL ?? ""); } catch { throw new Error("SUPABASE_URL is not a valid address"); }
  if (url.protocol !== "https:" || url.hostname !== target.supabaseHost || url.port || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`the database address does not belong to the ${name} target`);
  }
  if (env.WORKER_NAME?.trim() !== target.workerName) {
    throw new Error(`the Worker name does not belong to the ${name} target`);
  }
  const ref = target.supabaseHost.split(".")[0];
  if (target.requiresConfirmation && env.PUBLICATION_CONFIRM?.trim() !== `publish-${name}-${ref}`) {
    throw new Error(`publishing to ${name} needs PUBLICATION_CONFIRM=publish-${name}-${ref}`);
  }
  return { name, workerName: target.workerName, supabaseOrigin: url.origin };
}
