import { describe, expect, it } from "vitest";
import { createLocalCloudflareVersionPort } from "@/cloudflare/publication/local-cloudflare-version-port";

describe("local Cloudflare version port", () => {
  it("uploads an inactive version without moving the active deployment", async () => {
    const port = createLocalCloudflareVersionPort({ initialVersionId: "version-old" });
    const before = await port.currentDeployment();
    const uploaded = await port.uploadInactive("C:/package/candidate");
    expect(uploaded.versionId).not.toBe("version-old");
    expect(await port.currentDeployment()).toEqual(before);
    expect(await port.preview(uploaded.versionId)).toMatchObject({ url: expect.stringMatching(/^https:\/\//) });
  });

  it("activates and rolls back only known versions", async () => {
    const port = createLocalCloudflareVersionPort({ initialVersionId: "version-old" });
    const uploaded = await port.uploadInactive("C:/package/candidate");
    const activated = await port.activate(uploaded.versionId);
    expect((await port.currentDeployment()).versionId).toBe(uploaded.versionId);
    expect(activated.deploymentId).toBeTruthy();
    await port.rollback("version-old");
    expect((await port.currentDeployment()).versionId).toBe("version-old");
    await expect(port.preview("unknown")).rejects.toThrow("local_version_unavailable");
  });

  it("rejects empty paths and preserves state on invalid operations", async () => {
    const port = createLocalCloudflareVersionPort({ initialVersionId: "version-old" });
    await expect(port.uploadInactive(" ")).rejects.toThrow("local_version_unavailable");
    await expect(port.activate("unknown")).rejects.toThrow("local_version_unavailable");
    expect((await port.currentDeployment()).versionId).toBe("version-old");
  });
});
