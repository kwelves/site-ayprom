"use client";

import { forwardRef, type CSSProperties, type ImgHTMLAttributes } from "react";

// Browser stand-in for `next/image`: a plain <img>. The admin shows pictures that are
// already optimised on upload, so no resizing service is involved.
interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "width" | "height" | "placeholder"> {
  src: string | { src: string };
  alt: string;
  width?: number | string;
  height?: number | string;
  fill?: boolean;
  priority?: boolean;
  quality?: number | string;
  unoptimized?: boolean;
  placeholder?: string;
  blurDataURL?: string;
}

const NEXT_ONLY = ["quality", "unoptimized", "placeholder", "blurDataURL"] as const;

function omitNextOnly(props: ImageProps): ImageProps {
  const copy: Record<string, unknown> = { ...props };
  for (const key of NEXT_ONLY) delete copy[key];
  return copy as unknown as ImageProps;
}

function toProps(props: ImageProps) {
  // Next-only options (quality, unoptimized, placeholder, blurDataURL) have no meaning for a plain <img>.
  const { src, fill, priority, style, alt, ...rest } = omitNextOnly(props);
  const fillStyle: CSSProperties | undefined = fill
    ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style }
    : style;
  return {
    ...rest,
    alt,
    src: typeof src === "string" ? src : src.src,
    style: fillStyle,
    loading: priority ? ("eager" as const) : (rest.loading ?? ("lazy" as const)),
    decoding: "async" as const,
    fetchPriority: priority ? ("high" as const) : rest.fetchPriority,
  };
}

const Image = forwardRef<HTMLImageElement, ImageProps>(function Image(props, ref) {
  const imageProps = toProps(props);
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} {...imageProps} alt={imageProps.alt} />;
});

export function getImageProps(props: ImageProps) {
  return { props: toProps(props) };
}

export default Image;
