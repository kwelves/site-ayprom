"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getImageProps } from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { ImageFallback } from "@/components/ui/ImageFallback";
import { DURATION, EASE_UI } from "@/lib/motion";

export interface PreparedCarouselImage {
  url: string;
  scale?: number;
}

interface CarouselState {
  selectedIndex: number;
  committedIndex: number;
  direction: number;
  readyKey: string | null;
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
    direction: 0,
    readyKey: null,
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
          direction: delta > 0 ? 1 : -1,
          readyKey: nextIndex === current.selectedIndex ? current.readyKey : null,
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
          direction: wrapped > current.selectedIndex ? 1 : -1,
          readyKey: null,
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
      return key === currentKey ? { ...current, readyKey: key } : current;
    });
  }, []);

  const commitReady = useCallback((key: string) => {
    setState((current) => {
      const currentImages = imagesRef.current;
      const currentIndex = currentImages.length === 0 ? 0 : Math.min(current.selectedIndex, currentImages.length - 1);
      const currentKey = getPreparedImageKey(currentImages[currentIndex], currentIndex);
      if (key !== currentKey || current.readyKey !== key) return current;
      return { ...current, committedIndex: currentIndex, readyKey: null };
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
    direction: state.direction,
    selectedKey,
    committedKey,
    hasPendingImage,
    pendingReady: hasPendingImage && state.readyKey === selectedKey,
    neighborIndices,
    step,
    select,
    markReady,
    commitReady,
  };
}

export function getPreparedImageOffset(direction: number, shouldReduceMotion: boolean | null) {
  if (shouldReduceMotion) return 0;
  return direction > 0 ? 8 : -8;
}

interface PreparedImageLayersProps {
  images: PreparedCarouselImage[];
  alt: string;
  sizes: string;
  layerClassName: string;
  imageClassName?: string;
  carousel: ReturnType<typeof usePreparedImageCarousel>;
}

export function PreparedImageLayers({
  images,
  alt,
  sizes,
  layerClassName,
  imageClassName,
  carousel,
}: PreparedImageLayersProps) {
  const shouldReduceMotion = useReducedMotion();
  const layerIndices = carousel.hasPendingImage
    ? [carousel.committedIndex, carousel.selectedIndex]
    : [carousel.committedIndex];

  return layerIndices.map((index) => {
    const image = images[index];
    const key = getPreparedImageKey(image, index);
    const isPending = carousel.hasPendingImage && key === carousel.selectedKey;
    const hiddenOffset = getPreparedImageOffset(carousel.direction, shouldReduceMotion);
    const target = isPending && !carousel.pendingReady
      ? { x: hiddenOffset, opacity: 0 }
      : { x: 0, opacity: 1 };

    return (
      <motion.div
        key={key}
        data-carousel-layer={isPending ? "pending" : "committed"}
        aria-hidden={!isPending && carousel.hasPendingImage ? true : undefined}
        className={layerClassName}
        initial={isPending ? { x: hiddenOffset, opacity: 0 } : false}
        animate={target}
        transition={{ duration: DURATION.fast, ease: EASE_UI }}
        onAnimationComplete={() => {
          if (isPending && carousel.pendingReady) carousel.commitReady(key);
        }}
      >
        <ImageFallback
          src={image?.url}
          alt={alt}
          sizes={sizes}
          className={imageClassName}
          style={image?.scale && image.scale !== 1 ? { transform: `scale(${image.scale})` } : undefined}
          loading="eager"
          onLoad={isPending ? () => carousel.markReady(key) : undefined}
          onError={isPending ? () => carousel.markReady(key) : undefined}
        />
      </motion.div>
    );
  });
}

export function GalleryNeighborWarmup({ url, sizes }: { url: string; sizes: string }) {
  const { props } = getImageProps({
    src: url,
    alt: "",
    fill: true,
    sizes,
    loading: "eager",
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
