import type { StaticBuildIssue, ValidationResult } from "./validation";
import { isPortablePathSegment } from "./portable-path";

export type RouteFamily =
  | "home"
  | "about"
  | "contacts"
  | "catalog"
  | "category"
  | "subcategory"
  | "brand"
  | "vehicle-type"
  | "category-brand"
  | "brand-category"
  | "brand-category-subcategory"
  | "product"
  | "product-alias"
  | "robots"
  | "sitemap"
  | "not-found";

interface RouteEntryBase {
  family: RouteFamily;
  path: string;
  snapshotIds: string[];
}

export type RouteManifestEntry =
  | (RouteEntryBase & {
      class: "static" | "query";
      outputFile: string;
      expectedCanonical: string | null;
      expectedJsonLdTypes: string[];
      expectedIndexable: boolean;
    })
  | (RouteEntryBase & {
      class: "redirect";
      redirectTo: string;
      status: 308;
    })
  | (RouteEntryBase & {
      class: "invalid";
      reason: "canonical_unresolved" | "snapshot_reference_invalid";
    });

export interface RouteManifest {
  schemaVersion: 1;
  snapshotId: string;
  entries: RouteManifestEntry[];
}

export function routePathToOutputFile(routePath: string): string {
  assertCanonicalRoutePath(routePath);
  if (routePath === "/") return "index.html";
  if (routePath === "/404") return "404.html";
  if (routePath === "/robots.txt") return "robots.txt";
  if (routePath === "/sitemap.xml") return "sitemap.xml";
  return `${routePath.slice(1)}.html`;
}

export function createRouteManifest(
  snapshotId: string,
  entries: RouteManifestEntry[],
): ValidationResult<RouteManifest> {
  const issues: StaticBuildIssue[] = [];
  if (snapshotId.trim() === "") {
    issues.push({ field: "snapshotId", rule: "non_empty_string_required" });
  }

  const paths = new Map<string, number>();
  const lowercaseOutputs = new Map<string, { index: number; outputFile: string }>();

  for (const [index, entry] of entries.entries()) {
    const entryField = `entries[${index}]`;
    let expectedOutput: string | null = null;
    try {
      expectedOutput = routePathToOutputFile(entry.path);
    } catch {
      issues.push({ field: `${entryField}.path`, rule: "invalid_path" });
    }

    const previousPathIndex = paths.get(entry.path);
    if (previousPathIndex !== undefined) {
      issues.push({ field: `${entryField}.path`, rule: "duplicate_path" });
    } else {
      paths.set(entry.path, index);
    }

    validateSnapshotIds(entry.snapshotIds, `${entryField}.snapshotIds`, issues);

    if (entry.class === "static" || entry.class === "query") {
      if (expectedOutput && entry.outputFile !== expectedOutput) {
        issues.push({ field: `${entryField}.outputFile`, rule: "output_mismatch" });
      }
      const normalizedOutput = entry.outputFile.toLowerCase();
      const previousOutput = lowercaseOutputs.get(normalizedOutput);
      if (previousOutput) {
        issues.push({
          field: `${entryField}.outputFile`,
          rule: previousOutput.outputFile === entry.outputFile
            ? "duplicate_output_file"
            : "case_insensitive_output_collision",
        });
      } else if (!previousOutput) {
        lowercaseOutputs.set(normalizedOutput, {
          index,
          outputFile: entry.outputFile,
        });
      }
    } else if (entry.class === "redirect") {
      try {
        routePathToOutputFile(entry.redirectTo);
      } catch {
        issues.push({
          field: `${entryField}.redirectTo`,
          rule: "invalid_redirect_target",
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, code: "route_manifest_incomplete", issues };
  }

  const sortedEntries = [...entries].sort((left, right) => {
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    return 0;
  });

  return {
    ok: true,
    value: { schemaVersion: 1, snapshotId, entries: sortedEntries },
  };
}

export function serializeRouteManifest(manifest: RouteManifest): string {
  const entries = manifest.entries.map((entry): RouteManifestEntry => {
    const base = {
      class: entry.class,
      family: entry.family,
      path: entry.path,
      snapshotIds: entry.snapshotIds,
    };
    if (entry.class === "static" || entry.class === "query") {
      return {
        ...base,
        class: entry.class,
        outputFile: entry.outputFile,
        expectedCanonical: entry.expectedCanonical,
        expectedJsonLdTypes: entry.expectedJsonLdTypes,
        expectedIndexable: entry.expectedIndexable,
      };
    }
    if (entry.class === "redirect") {
      return { ...base, class: "redirect", redirectTo: entry.redirectTo, status: entry.status };
    }
    if (entry.class === "invalid") {
      return { ...base, class: "invalid", reason: entry.reason };
    }
    throw new Error("invalid route entry class");
  });
  return `${JSON.stringify({ schemaVersion: manifest.schemaVersion, snapshotId: manifest.snapshotId, entries }, null, 2)}\n`;
}

function assertCanonicalRoutePath(routePath: string) {
  if (
    routePath === "" ||
    !routePath.startsWith("/") ||
    routePath.startsWith("//") ||
    (routePath !== "/" && routePath.endsWith("/")) ||
    routePath.includes("\\") ||
    routePath.includes("?") ||
    routePath.includes("#")
  ) {
    throw new Error("invalid route path");
  }

  if (routePath === "/") return;

  const segments = routePath.slice(1).split("/");
  if (segments.some((segment) => !isPortablePathSegment(segment))) {
    throw new Error("invalid route path");
  }
}

function validateSnapshotIds(
  snapshotIds: string[],
  field: string,
  issues: StaticBuildIssue[],
) {
  const seen = new Set<string>();
  for (const [index, snapshotId] of snapshotIds.entries()) {
    if (snapshotId.trim() === "") {
      issues.push({ field: `${field}[${index}]`, rule: "non_empty_string_required" });
    }
    if (seen.has(snapshotId)) {
      issues.push({ field: `${field}[${index}]`, rule: "duplicate_snapshot_id" });
    }
    seen.add(snapshotId);
  }
}
