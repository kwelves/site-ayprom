import path from "node:path";
import { parseWorkersBuildAllowlist, resolveWorkersBuildBinding } from "./producer/workers-build-config";
import type { StaticBuildIssue, ValidationResult } from "./validation";

const RELEASE_SITE_ORIGIN = "https://www.ayprom-gidravlika.kg";
const RELEASE_MEDIA_ORIGIN = "https://media.ayprom-gidravlika.kg";
const LOCAL_SUPABASE_ORIGINS = new Set([
  "http://localhost:54321",
  "http://127.0.0.1:54321",
  "http://127.0.0.1:56421",
]);

export type StaticBuildSourceMode =
  | "fixture"
  | "local-snapshot"
  | "revisioned-live";

export interface StaticBuildPreflightInput {
  sourceMode: StaticBuildSourceMode;
  release: boolean;
  repoRoot: string;
  outputRoot: string;
  gitSha: string;
  hasTrackedChanges: boolean;
  requestedPort: number | null;
  requestedPortAvailable: boolean;
  env: Record<string, string | undefined>;
}

export interface StaticBuildPreflight {
  sourceMode: "fixture" | "local-snapshot";
  release: boolean;
  repoRoot: string;
  outputRoot: string;
  gitSha: string;
  requestedPort: number | null;
  siteOrigin: string;
  mediaOrigin: string;
  supabaseOrigin: string | null;
  supabasePublishableKey: string | null;
}

interface ParsedOrigin {
  origin: string | null;
  issue: StaticBuildIssue | null;
}

export function validateStaticBuildPreflight(
  input: StaticBuildPreflightInput,
): ValidationResult<StaticBuildPreflight> {
  const issues: StaticBuildIssue[] = [];

  if (input.env.AYPROM_STATIC_BUILD !== "1") {
    issues.push({ field: "AYPROM_STATIC_BUILD", rule: "must_equal_1" });
  }

  const site = parseOrigin("NEXT_PUBLIC_SITE_URL", input.env.NEXT_PUBLIC_SITE_URL);
  if (site.issue) issues.push(site.issue);
  if (site.origin && isLoopbackOrigin(site.origin)) {
    issues.push({ field: "NEXT_PUBLIC_SITE_URL", rule: "localhost_forbidden" });
  }
  if (input.release && site.origin && site.origin !== RELEASE_SITE_ORIGIN) {
    issues.push({ field: "NEXT_PUBLIC_SITE_URL", rule: "release_origin_mismatch" });
  }

  const media = parseOrigin(
    "NEXT_PUBLIC_MEDIA_BASE_URL",
    input.env.NEXT_PUBLIC_MEDIA_BASE_URL,
  );
  if (media.issue) issues.push(media.issue);
  if (input.release && media.origin && media.origin !== RELEASE_MEDIA_ORIGIN) {
    issues.push({
      field: "NEXT_PUBLIC_MEDIA_BASE_URL",
      rule: "release_origin_mismatch",
    });
  }

  if (input.env.NEXT_PUBLIC_HERO_MEDIA_SOURCE !== "r2") {
    issues.push({
      field: "NEXT_PUBLIC_HERO_MEDIA_SOURCE",
      rule: "must_equal_r2",
    });
  }

  if (input.sourceMode === "revisioned-live") {
    issues.push({ field: "sourceMode", rule: "live_mode_disabled" });
  }
  if (input.release && input.sourceMode === "fixture") {
    issues.push({ field: "sourceMode", rule: "fixture_not_releasable" });
  }

  const paths = resolveBuildPaths(input.repoRoot, input.outputRoot);
  if (!paths.insideDist) {
    issues.push({ field: "outputRoot", rule: "outside_dist" });
  }

  if (!/^[0-9a-f]{7,40}$/i.test(input.gitSha)) {
    issues.push({ field: "gitSha", rule: "invalid_sha" });
  }
  if (input.release && input.hasTrackedChanges) {
    issues.push({ field: "git", rule: "tracked_changes_forbidden" });
  }

  if (
    input.requestedPort !== null &&
    (!Number.isInteger(input.requestedPort) ||
      input.requestedPort < 1 ||
      input.requestedPort > 65_535)
  ) {
    issues.push({ field: "requestedPort", rule: "invalid_port" });
  } else if (input.requestedPort !== null && !input.requestedPortAvailable) {
    issues.push({ field: "requestedPort", rule: "port_unavailable" });
  }

  let supabaseOrigin: string | null = null;
  let supabasePublishableKey: string | null = null;
  if (input.sourceMode === "local-snapshot") {
    const hasSourceOverride = input.env.AYPROM_STATIC_BUILD_SUPABASE_URL !== undefined
      || input.env.AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY !== undefined;
    const sourceUrlField = hasSourceOverride ? "AYPROM_STATIC_BUILD_SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_URL";
    const sourceKeyField = hasSourceOverride
      ? "AYPROM_STATIC_BUILD_SUPABASE_PUBLISHABLE_KEY"
      : "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";
    if (hasSourceOverride) {
      const browser = parseOrigin("NEXT_PUBLIC_SUPABASE_URL", input.env.NEXT_PUBLIC_SUPABASE_URL);
      if (browser.issue) issues.push(browser.issue);
      const browserKeyIssue = validatePublishableKey(input.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim());
      if (browserKeyIssue) issues.push(browserKeyIssue);
    }
    const supabase = parseOrigin(
      sourceUrlField,
      input.env[sourceUrlField],
    );
    if (supabase.issue) {
      issues.push(supabase.issue);
    } else if (supabase.origin && input.env.AYPROM_WORKERS_BUILD_MODE === "workers-build") {
      const decision = resolveWorkersBuildBinding({
        mode: "workers-build",
        supabaseUrl: supabase.origin,
        publishableKey: input.env[sourceKeyField]?.trim() ?? "",
        allowlist: parseWorkersBuildAllowlist(input.env.AYPROM_WORKERS_BUILD_SUPABASE_ALLOWLIST),
      });
      if (!decision.ok || decision.url !== supabase.origin) {
        issues.push({ field: sourceUrlField, rule: "workers_build_binding_rejected" });
      } else if (input.release) {
        issues.push({ field: "release", rule: "workers_build_not_releasable" });
      } else {
        supabaseOrigin = decision.url;
      }
    } else if (supabase.origin && !LOCAL_SUPABASE_ORIGINS.has(supabase.origin)) {
      issues.push({
        field: sourceUrlField,
        rule: "local_snapshot_requires_loopback",
      });
    } else {
      supabaseOrigin = supabase.origin;
    }

    const key = input.env[sourceKeyField]?.trim();
    const keyIssue = validatePublishableKey(key, sourceKeyField);
    if (keyIssue) {
      issues.push(keyIssue);
    } else {
      supabasePublishableKey = key ?? null;
    }
  }

  if (issues.length > 0) {
    return { ok: false, code: "preflight_failed", issues };
  }

  return {
    ok: true,
    value: {
      sourceMode: input.sourceMode as "fixture" | "local-snapshot",
      release: input.release,
      repoRoot: paths.repoRoot,
      outputRoot: paths.outputRoot,
      gitSha: input.gitSha,
      requestedPort: input.requestedPort,
      siteOrigin: site.origin!,
      mediaOrigin: media.origin!,
      supabaseOrigin,
      supabasePublishableKey,
    },
  };
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function parseOrigin(field: string, rawValue: string | undefined): ParsedOrigin {
  const value = rawValue?.trim();
  if (!value) {
    return { origin: null, issue: { field, rule: "required" } };
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.username !== "" ||
      parsed.password !== ""
    ) {
      return { origin: null, issue: { field, rule: "origin_only_required" } };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { origin: null, issue: { field, rule: "invalid_url" } };
    }
    return { origin: parsed.origin, issue: null };
  } catch {
    return { origin: null, issue: { field, rule: "invalid_url" } };
  }
}

function validatePublishableKey(
  key: string | undefined,
  field = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
): StaticBuildIssue | null {
  if (!key) return { field, rule: "required" };

  const normalized = key.toLowerCase();
  if (normalized.startsWith("sb_secret_") || normalized.includes("service_role")) {
    return { field, rule: "secret_key_forbidden" };
  }
  if (normalized.startsWith("sb_publishable_") && key.length > "sb_publishable_".length) {
    return null;
  }

  const segments = key.split(".");
  if (
    segments.length !== 3 ||
    segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    return { field, rule: "invalid_publishable_key" };
  }

  try {
    const payload = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { role?: unknown };
    if (payload.role === "service_role") {
      return { field, rule: "service_role_forbidden" };
    }
    if (payload.role !== "anon") {
      return { field, rule: "invalid_publishable_key" };
    }
    return null;
  } catch {
    return { field, rule: "invalid_publishable_key" };
  }
}

function resolveBuildPaths(repoRoot: string, outputRoot: string) {
  const useWindowsPaths = /^[A-Za-z]:[\\/]/.test(repoRoot) || repoRoot.startsWith("\\\\");
  const pathApi = useWindowsPaths ? path.win32 : path.posix;
  const normalizeSeparators = (value: string) =>
    useWindowsPaths ? value.replaceAll("/", "\\") : value.replaceAll("\\", "/");
  const resolvedRepoRoot = pathApi.resolve(normalizeSeparators(repoRoot));
  const resolvedOutputRoot = pathApi.resolve(normalizeSeparators(outputRoot));
  const distRoot = pathApi.resolve(resolvedRepoRoot, "dist");
  const relative = pathApi.relative(distRoot, resolvedOutputRoot);
  const insideDist =
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${pathApi.sep}`) &&
    !pathApi.isAbsolute(relative);

  return {
    repoRoot: resolvedRepoRoot,
    outputRoot: resolvedOutputRoot,
    insideDist,
  };
}
