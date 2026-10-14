import { requestPhotoWorker, requestPublicationWorker } from "@/lib/photo-queue/enqueue";

// Scheduled check (Cloudflare Cron Trigger, every 15 minutes). The admin wakes the publication and photo workers right
// after an edit, but a wake-up can be lost (GitHub unavailable, an expired token, a worker that crashed). This check
// notices work that has been waiting too long and wakes the worker again. It also reads the database every time,
// which keeps a free Supabase project from going to sleep after a week without visitors.
// It never throws and never prints secrets.
const PUBLICATION_WAIT_MS = 5 * 60_000;
const PHOTO_WAIT_MS = 10 * 60_000;
const MAX_ATTEMPTS = 3;

type Env = Record<string, string | undefined>;
type Wake = { publication: (env: Env) => Promise<boolean>; photo: (env: Env) => Promise<boolean> };
export interface SafetyNetReport {
  publication: "not_configured" | "up_to_date" | "waiting" | "in_progress" | "needs_a_person" | "woken" | "wake_refused" | "check_failed";
  photos: "not_configured" | "idle" | "woken" | "wake_refused" | "check_failed";
}
interface Dependencies {
  now?: () => number;
  fetchImpl?: typeof fetch;
  wake?: Wake;
}

export async function runSafetyNet(env: Env, dependencies: Dependencies = {}): Promise<SafetyNetReport> {
  const now = dependencies.now ?? Date.now;
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const wake: Wake = dependencies.wake ?? { publication: (value) => requestPublicationWorker(value), photo: (value) => requestPhotoWorker(value) };
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return { publication: "not_configured", photos: "not_configured" };

  const read = async (pathAndQuery: string): Promise<unknown[]> => {
    const response = await fetchImpl(`${url}/rest/v1/${pathAndQuery}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`database read failed (${response.status})`);
    const rows: unknown = await response.json();
    return Array.isArray(rows) ? rows : [];
  };
  const fail = (label: string, error: unknown) => {
    // Only the kind of error is logged: messages can echo request details.
    console.error(`[safety-net] ${label} check failed: ${error instanceof Error ? error.name : typeof error}`);
    return "check_failed" as const;
  };

  const publication = await (async (): Promise<SafetyNetReport["publication"]> => {
    try {
      const [revision] = (await read("content_revision?select=current_revision,updated_at&singleton=eq.true")) as Array<{ current_revision: number; updated_at: string }>;
      const [job] = (await read("publication_jobs?select=deployed_revision,lease_until,attempt_count&singleton=eq.true")) as Array<{ deployed_revision: number; lease_until: string | null; attempt_count: number }>;
      if (!revision || !job || Number(revision.current_revision) <= Number(job.deployed_revision)) return "up_to_date";
      if (job.lease_until && Date.parse(job.lease_until) > now()) return "in_progress";
      if (Number(job.attempt_count) >= MAX_ATTEMPTS) return "needs_a_person";
      if (now() - Date.parse(revision.updated_at) < PUBLICATION_WAIT_MS) return "waiting";
      return (await wake.publication(env)) ? "woken" : "wake_refused";
    } catch (error) { return fail("publication", error); }
  })();

  const photos = await (async (): Promise<SafetyNetReport["photos"]> => {
    try {
      const cutoff = new Date(now() - PHOTO_WAIT_MS).toISOString();
      const nowIso = new Date(now()).toISOString();
      const waiting = await read(
        `product_image_staging?select=id&queued_at=lt.${encodeURIComponent(cutoff)}&finalized_at=is.null&failed_at=is.null`
        + `&or=${encodeURIComponent(`(lease_until.is.null,lease_until.lt.${nowIso})`)}&limit=1`,
      );
      if (waiting.length === 0) return "idle";
      return (await wake.photo(env)) ? "woken" : "wake_refused";
    } catch (error) { return fail("photos", error); }
  })();

  return { publication, photos };
}
