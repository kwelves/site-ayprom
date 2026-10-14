import { describe, expect, it } from "vitest";
import { adoptionPlan, currentDeployment, versionOfDeployment } from "../scripts/cloudflare/publication-reconcile.mjs";

const deployments = [
  { id: "aaaa1111-0000-4000-8000-000000000001", created_on: "2026-10-09T10:00:00Z", versions: [{ version_id: "ver-old", percentage: 100 }] },
  { id: "bbbb2222-0000-4000-8000-000000000002", created_on: "2026-10-09T11:00:00Z", versions: [{ version_id: "ver-b", percentage: 100 }] },
  { id: "cccc3333-0000-4000-8000-000000000003", created_on: "2026-10-09T12:00:00Z", versions: [{ version_id: "ver-b", percentage: 100 }] },
];
const OLD = "bbbb2222-0000-4000-8000-000000000002";
const NEW = "cccc3333-0000-4000-8000-000000000003";

describe("reading the Cloudflare deployment list", () => {
  it("finds the newest deployment and the version of any deployment", () => {
    expect(currentDeployment(deployments)).toEqual({ deploymentId: NEW, versionId: "ver-b" });
    expect(versionOfDeployment(deployments, OLD)).toBe("ver-b");
    expect(versionOfDeployment(deployments, "missing")).toBeNull();
  });

  it("refuses a deployment that is split between versions", () => {
    const split = [{ id: NEW, created_on: "2026-10-09T12:00:00Z", versions: [{ version_id: "a", percentage: 50 }, { version_id: "b", percentage: 50 }] }];
    expect(currentDeployment(split)).toBeNull();
    expect(versionOfDeployment(split, NEW)).toBeNull();
  });
});

describe("adoptionPlan: the database remembers an older deployment of the version that is live now", () => {
  const live = { deploymentId: NEW, versionId: "ver-b" };

  it("adopts the new deployment id when it is the very same version after a rollback", () => {
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: `cf:${OLD}` }, pointerRevision: 707, hosting: live, deployments }))
      .toEqual({ adopt: true, from: `cf:${OLD}`, to: `cf:${NEW}`, revision: 707 });
  });

  it("does nothing when everything already agrees", () => {
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: `cf:${NEW}` }, pointerRevision: 707, hosting: live, deployments }).adopt).toBe(false);
  });

  it("never adopts when the live version differs from the remembered one, or the revisions disagree", () => {
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: "cf:aaaa1111-0000-4000-8000-000000000001" }, pointerRevision: 707, hosting: live, deployments }).adopt).toBe(false);
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: `cf:${OLD}` }, pointerRevision: 700, hosting: live, deployments }).adopt).toBe(false);
    expect(adoptionPlan({ queue: { deployedRevision: 0, deploymentIdentifier: null }, pointerRevision: 707, hosting: live, deployments }).adopt).toBe(false);
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: "not-ours" }, pointerRevision: 707, hosting: live, deployments }).adopt).toBe(false);
    expect(adoptionPlan({ queue: { deployedRevision: 707, deploymentIdentifier: `cf:${OLD}` }, pointerRevision: 707, hosting: null, deployments }).adopt).toBe(false);
  });
});
