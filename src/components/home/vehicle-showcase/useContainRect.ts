import { useLayoutEffect, useState, type RefObject } from "react";

export interface ContainRect {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The measuring box's own size — hotspots can end up outside 0..boxWidth/
   * boxHeight once `scale` pushes the photo past strict contain-fit, so
   * callers need the box bounds (not just the photo rect) to decide which
   * side has room for things like a tooltip. */
  boxWidth: number;
  boxHeight: number;
}

/**
 * The rendered rect of an `object-contain` image within its box — the same
 * geometry the browser computes internally, exposed so hotspot markers can
 * be placed in pixels against the actual visible photo instead of against
 * the (differently-proportioned, letterboxed) box around it.
 *
 * `scale` (default 1) inflates the result beyond strict contain-fit, kept
 * centered on the same point — used to size the vehicle up beyond "fits
 * exactly" while hotspots (computed from this same rect) stay pinned to the
 * same spot on the enlarged photo instead of drifting.
 */
export function useContainRect(
  boxRef: RefObject<HTMLElement | null>,
  naturalWidth: number,
  naturalHeight: number,
  scale = 1,
): ContainRect {
  const [rect, setRect] = useState<ContainRect>({ left: 0, top: 0, width: 0, height: 0, boxWidth: 0, boxHeight: 0 });

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const compute = () => {
      const boxWidth = box.clientWidth;
      const boxHeight = box.clientHeight;
      const boxRatio = boxWidth / boxHeight;
      const imageRatio = naturalWidth / naturalHeight;

      let width: number;
      let height: number;
      if (imageRatio > boxRatio) {
        width = boxWidth;
        height = boxWidth / imageRatio;
      } else {
        height = boxHeight;
        width = boxHeight * imageRatio;
      }

      width *= scale;
      height *= scale;

      setRect({ left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height, boxWidth, boxHeight });
    };

    compute();
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(box);
    return () => resizeObserver.disconnect();
  }, [boxRef, naturalWidth, naturalHeight, scale]);

  return rect;
}
