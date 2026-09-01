"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { ImageFallback } from "@/components/ui/ImageFallback";

export interface PreparedCarouselImage {
  url: string;
  /** Always-durable master to retry once before the "no photo" placeholder,
   * when `url` is a generated variant that might 404 independently of the
   * DB row. See resolveImageFallbackUrl(). */
  fallbackUrl?: string;
  scale?: number;
}

interface CarouselState {
  selectedIndex: number;
  committedIndex: number;
}

export function getPreparedImageKey(image: PreparedCarouselImage | undefined, index: number) {
  return `${image?.url ?? "image-fallback"}-${index}`;
}

export function usePreparedImageCarousel(images: PreparedCarouselImage[]) {
  const imagesRef = useRef(images);
  useLayoutEffect(() => {
    imagesRef.current = images;
  }, [images]);
  const [state, setState] = useState<CarouselState>({
    selectedIndex: 0,
    committedIndex: 0,
  });

  const safeSelectedIndex = images.length === 0 ? 0 : Math.min(state.selectedIndex, images.length - 1);
  const safeCommittedIndex = images.length === 0 ? 0 : Math.min(state.committedIndex, images.length - 1);
  const selectedKey = getPreparedImageKey(images[safeSelectedIndex], safeSelectedIndex);
  const committedKey = getPreparedImageKey(images[safeCommittedIndex], safeCommittedIndex);
  const hasPendingImage = selectedKey !== committedKey;

  const step = useCallback(
    (delta: number) => {
      if (images.length === 0 || delta === 0) return;
      setState((current) => {
        const nextIndex = (current.selectedIndex + delta + images.length) % images.length;
        return {
          ...current,
          selectedIndex: nextIndex,
        };
      });
    },
    [images.length],
  );

  const select = useCallback(
    (nextIndex: number) => {
      if (images.length === 0) return;
      setState((current) => {
        const wrapped = (nextIndex + images.length) % images.length;
        if (wrapped === current.selectedIndex) return current;
        return {
          ...current,
          selectedIndex: wrapped,
        };
      });
    },
    [images.length],
  );

  const markReady = useCallback((key: string) => {
    setState((current) => {
      const currentImages = imagesRef.current;
      const currentIndex = currentImages.length === 0 ? 0 : Math.min(current.selectedIndex, currentImages.length - 1);
      const currentKey = getPreparedImageKey(currentImages[currentIndex], currentIndex);
      if (key !== currentKey) return current;
      return { ...current, committedIndex: currentIndex };
    });
  }, []);

  const neighborIndices = useMemo(() => {
    if (images.length <= 1) return [];
    return [...new Set([safeSelectedIndex + 1, safeSelectedIndex - 1].map((index) => (index + images.length) % images.length))]
      .filter((index) => images[index]?.url && index !== safeSelectedIndex);
  }, [images, safeSelectedIndex]);

  return {
    selectedIndex: safeSelectedIndex,
    committedIndex: safeCommittedIndex,
    selectedKey,
    committedKey,
    hasPendingImage,
    neighborIndices,
    step,
    select,
    markReady,
  };
}

interface PreparedImageLayersProps {
  images: PreparedCarouselImage[];
  alt: string;
  sizes: string;
  layerClassName: string;
  imageClassName?: string;
  quality?: number;
  /** Serves every layer's `src` as-is, bypassing Vercel Image Optimization (and its quota). */
  unoptimized?: boolean;
  carousel: ReturnType<typeof usePreparedImageCarousel>;
}

export function PreparedImageLayers({
  images,
  alt,
  sizes,
  layerClassName,
  imageClassName,
  quality,
  unoptimized,
  carousel,
}: PreparedImageLayersProps) {
  const layerIndices = carousel.hasPendingImage
    ? [carousel.committedIndex, carousel.selectedIndex]
    : [carousel.committedIndex];

  return layerIndices.map((index) => {
    const image = images[index];
    const key = getPreparedImageKey(image, index);
    const isPending = carousel.hasPendingImage && key === carousel.selectedKey;

    return (
      <div
        key={key}
        data-carousel-layer={isPending ? "pending" : "committed"}
        aria-hidden={isPending ? true : undefined}
        className={layerClassName}
        style={isPending ? { visibility: "hidden" } : undefined}
      >
        <ImageFallback
          src={image?.url}
          fallbackSrc={image?.fallbackUrl}
          alt={alt}
          sizes={sizes}
          className={imageClassName}
          style={image?.scale && image.scale !== 1 ? { transform: `scale(${image.scale})` } : undefined}
          loading="eager"
          quality={quality}
          unoptimized={unoptimized}
          onLoad={isPending ? () => carousel.markReady(key) : undefined}
          onError={isPending ? () => carousel.markReady(key) : undefined}
        />
      </div>
    );
  });
}

export function GalleryNeighborWarmup({
  url,
  sizes,
  quality,
  unoptimized,
}: {
  url: string;
  sizes: string;
  quality?: number;
  unoptimized?: boolean;
}) {
  const { props } = getImageProps({
    src: url,
    alt: "",
    fill: true,
    sizes,
    loading: "eager",
    quality,
    unoptimized,
  });

  return (
    // eslint-disable-next-line @next/next/no-img-element -- network-only cache warmup
    <img
      {...props}
      alt=""
      aria-hidden="true"
      fetchPriority="low"
      decoding="async"
      style={{ position: "absolute", height: 1, width: 1, opacity: 0, pointerEvents: "none" }}
    />
  );
}
