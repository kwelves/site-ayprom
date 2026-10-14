import { randomUUID } from "node:crypto";
import type { CloudflareVersionPort } from "./cloudflare-version-port";

interface LocalVersion {
  versionId: string;
  packageDir: string;
  deploymentId: string | null;
}

export function createLocalCloudflareVersionPort(input: {
  initialVersionId: string;
  previewOrigin?: string;
}): CloudflareVersionPort {
  const origin = input.previewOrigin ?? "https://local-preview.example.test";
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(input.initialVersionId) || !validOrigin(origin)) {
    throw new Error("local_version_unavailable");
  }
  const versions = new Map<string, LocalVersion>([[input.initialVersionId, {
    versionId: input.initialVersionId, packageDir: "<active>", deploymentId: `deployment-${randomUUID()}`,
  }]]);
  let activeVersionId = input.initialVersionId;

  const get = (versionId: string): LocalVersion => {
    const version = versions.get(versionId);
    if (!version) throw new Error("local_version_unavailable");
    return version;
  };
  return {
    async uploadInactive(packageDir) {
      if (typeof packageDir !== "string" || !packageDir.trim()) throw new Error("local_version_unavailable");
      const versionId = `version-${randomUUID()}`;
      versions.set(versionId, { versionId, packageDir, deploymentId: null });
      return { versionId };
    },
    async preview(versionId) {
      get(versionId);
      return { url: `${origin}/${encodeURIComponent(versionId)}` };
    },
    async currentDeployment() {
      const version = get(activeVersionId);
      if (!version.deploymentId) throw new Error("local_version_unavailable");
      return { deploymentId: version.deploymentId, versionId: version.versionId };
    },
    async activate(versionId) {
      const version = get(versionId);
      version.deploymentId = `deployment-${randomUUID()}`;
      activeVersionId = versionId;
      return { deploymentId: version.deploymentId };
    },
    async rollback(versionId) {
      const version = get(versionId);
      if (!version.deploymentId) version.deploymentId = `deployment-${randomUUID()}`;
      activeVersionId = versionId;
      return { deploymentId: version.deploymentId };
    },
  };
}

function validOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
