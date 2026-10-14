// Explicit local contract only: no remote port, environment credentials or network probe.
// The fixture checks real package bytes and durable history; it cannot verify a remote preview.
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPublicationPackage } from "./publication-package-inspector.mjs";

const flags = { fixtureOnly: true, remoteVerified: false, productionReady: false };
const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== "--local-contract" || args[1] !== "--package"
  || args[3] !== "--journal" || !args[2] || args[2].startsWith("--")
  || !path.isAbsolute(args[4]) || !args[4].toLowerCase().endsWith(".jsonl")) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: "invalid_arguments", ...flags })}\n`);
  process.exitCode = 2;
} else {
  try {
    if (!process.features.typescript) throw new Error();
    const packageDir = path.resolve(args[2]);
    const inspected = await inspectPublicationPackage(packageDir);
    if (!inspected.ok) {
      process.stdout.write(`${JSON.stringify({ ok: false, status: "rejected", ...flags })}\n`);
      process.exitCode = 1;
    } else {
      const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
      register("./static-producer-loader.mjs", { parentURL: import.meta.url, data: { srcRoot: path.join(root, "src") } });
      const load = (name) => import(pathToFileURL(path.join(root, "src/cloudflare/publication", name)).href);
      const { stagePublicationPackage } = await load("stage-publication-package.ts");
      const { createLocalCloudflareVersionPort } = await load("local-cloudflare-version-port.ts");
      const cloudflare = createLocalCloudflareVersionPort({ initialVersionId: "local-contract-old" });
      const candidate = { packageDir, releaseId: inspected.releaseId, revision: inspected.revision,
        releaseSha256: inspected.releaseSha256, packageSha256: inspected.packageSha256 };
      const result = await stagePublicationPackage({ candidate, cloudflare, journalPath: args[4],
        probe: async ({ releaseId }) => {
          const rechecked = await inspectPublicationPackage(packageDir);
          return rechecked.ok && rechecked.releaseId === releaseId
            && rechecked.revision === candidate.revision && rechecked.releaseSha256 === candidate.releaseSha256
            && rechecked.packageSha256 === candidate.packageSha256;
        },
      });
      process.stdout.write(`${JSON.stringify({ ...result, ...flags })}\n`);
      process.exitCode = result.ok ? 0 : 1;
    }
  } catch {
    process.stdout.write(`${JSON.stringify({ ok: false, status: "unresolved", ...flags })}\n`);
    process.exitCode = 1;
  }
}
