// Image processing needs native code that a Worker does not have: it runs in the external
// photo processor (queue `product_media_jobs`). Reaching this stand-in means a code path
// that must be handed to that processor was called inside the Worker.
export default function sharp(): never {
  throw new Error("sharp_unavailable_in_worker");
}
