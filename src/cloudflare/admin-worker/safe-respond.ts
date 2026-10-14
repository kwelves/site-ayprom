import { runWithBackground } from "@/lib/background-tasks";
import { captureException } from "./shims/sentry";

/** A failure nothing else caught is reported (class and places in the code only) and answered with a plain 500. */
export async function respondSafely(
  respond: () => Promise<Response>,
  ctx: { waitUntil(promise: Promise<unknown>): void },
): Promise<Response> {
  try {
    return await respond();
  } catch (error) {
    await runWithBackground((promise) => ctx.waitUntil(promise), async () => {
      captureException(error, { tags: { subsystem: "admin-worker" } });
    });
    return new Response("Internal error", { status: 500, headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" } });
  }
}
