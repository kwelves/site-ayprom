import { AsyncLocalStorage } from "node:async_hooks";

// "Do this after the answer is sent". A Cloudflare Worker may stop right after it responds, so work that
// must outlive the response has to be handed to the platform's waitUntil. The Worker wraps each request in
// runWithBackground(); anywhere else the work simply runs on its own.
type Scheduler = (promise: Promise<unknown>) => void;

const storage = new AsyncLocalStorage<Scheduler>();

export function runWithBackground<T>(scheduler: Scheduler, run: () => Promise<T>): Promise<T> {
  return storage.run(scheduler, run);
}

export function runInBackground(promise: Promise<unknown>): void {
  const safe = promise.catch(() => undefined);
  const scheduler = storage.getStore();
  if (scheduler) scheduler(safe);
}
