import { useLayoutEffect, useState, type RefObject } from "react";

export interface ContainRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The rendered rect of an `object-contain` image within its box — the same
 * geometry the browser computes internally, exposed so hotspot markers can
 * be placed in pixels against the actual visible photo instead of against
 * the (differently-proportioned, letterboxed) box around it.
 */
export function useContainRect(
  boxRef: RefObject<HTMLElement | null>,
  naturalWidth: number,
  naturalHeight: number,
): ContainRect {
  const [rect, setRect] = useState<ContainRect>({ left: 0, top: 0, width: 0, height: 0 });

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

      setRect({ left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height });
    };

    compute();
    const resizeObserver = new ResizeObserver(compute);
    resizeObserver.observe(box);
    return () => resizeObserver.disconnect();
  }, [boxRef, naturalWidth, naturalHeight]);

  return rect;
}
