// What the admin tells the owner about publishing: are the latest edits already on the public site?
export type PublicationState = "published" | "pending" | "publishing" | "failed";

export interface PublicationRow {
  currentRevision: number;
  deployedRevision: number;
  leaseUntil: string | null;
  attemptCount: number;
  lastErrorCode: string | null;
}

export interface PublicationStatus {
  state: PublicationState;
  /** How many content changes the public site has not caught up with yet. */
  behind: number;
  lastErrorCode: string | null;
}

const MAX_ATTEMPTS = 3;

export function describePublicationStatus(row: PublicationRow, now: number): PublicationStatus {
  const behind = Math.max(0, row.currentRevision - row.deployedRevision);
  if (behind === 0) return { state: "published", behind: 0, lastErrorCode: null };
  const leaseUntil = row.leaseUntil ? Date.parse(row.leaseUntil) : Number.NaN;
  if (Number.isFinite(leaseUntil) && leaseUntil > now) return { state: "publishing", behind, lastErrorCode: null };
  if (row.attemptCount >= MAX_ATTEMPTS && row.lastErrorCode) return { state: "failed", behind, lastErrorCode: row.lastErrorCode };
  return { state: "pending", behind, lastErrorCode: null };
}
