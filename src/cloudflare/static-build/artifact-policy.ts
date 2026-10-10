import type { StaticBuildIssue, ValidationResult } from "./validation";
import { isPortablePathSegment } from "./portable-path";

export const STATIC_ASSET_WARNING_COUNT = 15_000;
export const STATIC_ASSET_MAX_COUNT = 20_000;
export const STATIC_ASSET_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface ArtifactCandidate {
  path: string;
  size: number;
  text?: string;
}

export interface ArtifactPolicySummary {
  fileCount: number;
  totalBytes: number;
  maxFileBytes: number;
  warnings: ("file_count_warning")[];
}

const forbiddenText = [
  /service_role/i,
  /sb_secret_/i,
  /SUPABASE_SECRET_KEY/i,
  /ADMIN_PASSWORD/i,
  /ADMIN_SESSION_SECRET/i,
  /R2_SECRET_ACCESS_KEY/i,
  /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#\s"'`]|$)/i,
  /(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}\b/i,
  /\/storage\/v1\/object\/public\/site-media\/hero/i,
  /vercel\.app/i,
];

export function validateArtifactPolicy(
  files: ArtifactCandidate[],
): ValidationResult<ArtifactPolicySummary> {
  const issues: StaticBuildIssue[] = [];
  let totalBytes = 0;
  let maxFileBytes = 0;

  if (files.length > STATIC_ASSET_MAX_COUNT) {
    issues.push({ field: "files", rule: "file_count_limit_exceeded" });
  }

  const paths = new Map<string, string[]>();
  for (const file of files) {
    const field = file.path;

    if (!isValidArtifactPath(field)) {
      issues.push({ field, rule: "invalid_path" });
    } else {
      if (isForbiddenArtifactPath(field)) {
        issues.push({ field, rule: "forbidden_path" });
      }
      const lowercasePath = field.toLowerCase();
      const previousPaths = paths.get(lowercasePath) ?? [];
      previousPaths.push(field);
      paths.set(lowercasePath, previousPaths);
    }

    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      issues.push({ field, rule: "invalid_size" });
    } else {
      totalBytes += file.size;
      maxFileBytes = Math.max(maxFileBytes, file.size);
      if (file.size > STATIC_ASSET_MAX_FILE_BYTES) {
        issues.push({ field, rule: "file_too_large" });
      }
    }

    if (file.text !== undefined && hasForbiddenContent(file.text, field)) {
      issues.push({ field, rule: "forbidden_content" });
    }
  }

  const sortedPathGroups = [...paths.entries()].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  for (const [, groupedPaths] of sortedPathGroups) {
    const firstPath = groupedPaths[0];
    for (const path of groupedPaths.slice(1)) {
      issues.push({
        field: path,
        rule: path === firstPath ? "duplicate_path" : "case_insensitive_collision",
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, code: "artifact_policy_failed", issues };
  }

  return {
    ok: true,
    value: {
      fileCount: files.length,
      totalBytes,
      maxFileBytes,
      warnings: files.length >= STATIC_ASSET_WARNING_COUNT ? ["file_count_warning"] : [],
    },
  };
}

function hasForbiddenContent(text: string, path: string): boolean {
  if (forbiddenText.some((pattern) => pattern.test(text))) return true;
  if (!/^_next\/static\/.*\.js$/i.test(path) && /\/_next\/image/i.test(text)) {
    return true;
  }

  const jwtPattern = /[A-Za-z0-9_-]{8,}\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g;
  for (const match of text.matchAll(jwtPattern)) {
    const encodedPayload = match[1];
    if (encodedPayload.length > 8_192) continue;
    try {
      const payload = JSON.parse(
        atob(encodedPayload.replaceAll("-", "+").replaceAll("_", "/")),
      ) as { role?: unknown };
      if (payload.role === "service_role") return true;
    } catch {
      // A dotted asset/version string is not necessarily a JWT.
    }
  }
  return false;
}

function isValidArtifactPath(path: string): boolean {
  if (
    path === "" ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#")
  ) {
    return false;
  }
  return path.split("/").every(isPortablePathSegment);
}

function isForbiddenArtifactPath(path: string): boolean {
  const segments = path.toLowerCase().split("/");
  const basename = segments.at(-1)!;
  return (
    segments.some((segment) => segment.startsWith(".env")) ||
    segments.includes("src") ||
    segments.includes("node_modules") ||
    basename === "_worker.js" ||
    /\.(?:map|md|rsc|meta|mp4|webm|mov)$/.test(basename)
  );
}
