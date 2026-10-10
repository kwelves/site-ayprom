export type StaticBuildFailureCode =
  | "preflight_failed"
  | "snapshot_invalid"
  | "route_manifest_incomplete"
  | "artifact_policy_failed";

export interface StaticBuildIssue {
  field: string;
  rule: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: StaticBuildFailureCode; issues: StaticBuildIssue[] };
