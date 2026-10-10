// After a rollback, Cloudflare creates a NEW deployment that serves the same version as before, while the
// database still remembers the old deployment id. The release coordinator refuses to publish on top of such a
// mismatch. This module recognises that harmless case (same version, same revision) so the publication worker
// can update the remembered id; any other kind of disagreement is left alone for a person to look at.
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wholeVersion(deployment) {
  const versions = deployment?.versions;
  if (!Array.isArray(versions) || versions.length !== 1) return null;
  const [only] = versions;
  return only?.percentage === 100 && typeof only.version_id === "string" && only.version_id ? only.version_id : null;
}

/** The newest deployment of the Worker, when it serves exactly one version. */
export function currentDeployment(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) return null;
  const newest = [...deployments].sort((a, b) => String(a.created_on).localeCompare(String(b.created_on))).at(-1);
  const versionId = wholeVersion(newest);
  return ID.test(String(newest?.id)) && versionId ? { deploymentId: newest.id, versionId } : null;
}

export function versionOfDeployment(deployments, id) {
  const found = Array.isArray(deployments) ? deployments.find((deployment) => deployment?.id === id) : undefined;
  return found ? wholeVersion(found) : null;
}

export function adoptionPlan({ queue, pointerRevision, hosting, deployments }) {
  const no = (reason) => ({ adopt: false, reason });
  if (!hosting) return no("no_current_deployment");
  if (!queue || queue.deployedRevision < 1 || queue.deployedRevision !== pointerRevision) return no("revision_mismatch");
  const remembered = queue.deploymentIdentifier;
  if (typeof remembered !== "string" || !remembered.startsWith("cf:") || !ID.test(remembered.slice(3))) return no("no_remembered_deployment");
  if (remembered === `cf:${hosting.deploymentId}`) return no("already_in_agreement");
  if (versionOfDeployment(deployments, remembered.slice(3)) !== hosting.versionId) return no("different_version");
  return { adopt: true, from: remembered, to: `cf:${hosting.deploymentId}`, revision: queue.deployedRevision };
}
