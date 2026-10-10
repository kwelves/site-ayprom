import type { ImgHTMLAttributes } from "react";

// Only the browser <img> boundary is substituted. The actual ImageFallback
// state machine, callbacks and decode() run unchanged in Chromium.
export default function LocalImage({ alt = "", fill, unoptimized, quality, ...props }: ImgHTMLAttributes<HTMLImageElement>
  & { fill?: boolean; unoptimized?: boolean; quality?: number }) {
  void fill; void unoptimized; void quality;
  // eslint-disable-next-line @next/next/no-img-element -- local browser fault fixture
  return <img alt={alt} {...props} />;
}
