// Stand-in for `next/cache`. On Cloudflare the public site is a published snapshot, so there is
// no page cache to clear: edits become visible through the publication step instead.
export function revalidatePath(...args: unknown[]): void { void args; }
export function revalidateTag(...args: unknown[]): void { void args; }
export function updateTag(...args: unknown[]): void { void args; }
export function refresh(): void {}
