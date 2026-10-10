import { inspectPublicationPackage } from "./publication-package-inspector.mjs";

// This command has no upload/activate/deploy mode and never reads .env.
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--package" || !args[1] || args[1].startsWith("--")) {
  process.stdout.write(`${JSON.stringify({ ok: false, code: "invalid_arguments", productionReady: false })}\n`);
  process.exitCode = 2;
} else {
  const result = await inspectPublicationPackage(args[1]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}
