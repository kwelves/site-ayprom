import path from "node:path";
import { readAdminPreviewRuntime } from "./admin-preview-runtime.mjs";
import { previewSelectionStatus } from "./local-preview-selector.mjs";

// Read-only lookup of the selected local admin preview.
// It does not start a Worker and does not write the selection.
export function resolveSelectedAdminPreview({ repoRoot, expectedGeneration }, hooks = {}) {
  const readStatus = hooks.status ?? previewSelectionStatus;
  const readRuntime = hooks.readRuntime ?? readAdminPreviewRuntime;
  try {
    const before = readStatus({ repoRoot });
    if (!before.ok) return { ok: false, code: before.code, rule: before.rule };
    if (!before.current) return { ok: false, code: "selection_missing" };
    if (before.generation !== expectedGeneration) return { ok: false, code: "generation_mismatch" };
    const packageDir = selectedPackageDir(repoRoot, before.current);
    if (!packageDir) return { ok: false, code: "package_rejected", rule: "invalid_name" };
    let runtime;
    try {
      runtime = readRuntime(packageDir);
    } catch (error) {
      return { ok: false, code: "package_rejected", rule: safePackageRule(error) };
    }
    const after = readStatus({ repoRoot });
    if (!after.ok) return { ok: false, code: after.code, rule: after.rule };
    if (after.generation !== before.generation || after.current !== before.current) {
      return { ok: false, code: "selection_changed" };
    }
    return { ok: true, generation: after.generation, packageName: after.current, runtime };
  } catch {
    return { ok: false, code: "selection_read_failed" };
  }
}

function selectedPackageDir(repoRoot, packageName) {
  // Dots inside a basename are valid selector names, not parent traversal.
  // Standalone dot segments still fail the basename equality below.
  if (typeof packageName !== "string" || packageName.includes("/") || packageName.includes("\\")) return "";
  const root = path.resolve(repoRoot);
  const target = path.join(root, "dist", "worker-packages", packageName);
  return path.basename(target) === packageName ? target : "";
}

function safePackageRule(error) {
  const message = error instanceof Error ? error.message : "";
  if (message === "missing_inventory" || message === "package_integrity_failed" || message === "invalid_admin_preview") return message;
  return "invalid_admin_preview";
}
