"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageFallbackProps {
  src?: string;
  /** Retried once, in place of `src`, before the placeholder shows — for a
   * generated variant (thumbnail/gallery) that 404s or fails to decode
   * independently of the DB row, e.g. an interrupted backfill. The always-
   * durable master to fall back to; see resolveImageFallbackUrl(). */
  fallbackSrc?: string;
  alt: string;
  sizes: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  quality?: number;
  style?: React.CSSProperties;
  fallbackLabel?: string;
  /** Serves the active src as-is, bypassing Vercel Image Optimization (and its quota). */
  unoptimized?: boolean;
  onLoad?: () => void;
  onError?: () => void;
}

type Attempt = "primary" | "fallback" | "failed";

export function ImageFallback({
  src,
  fallbackSrc,
  alt,
  sizes,
  className,
  loading,
  fetchPriority,
  quality,
  style,
  fallbackLabel = "Фотография пока не добавлена",
  unoptimized,
  onLoad,
  onError,
}: ImageFallbackProps) {
  const [attempt, setAttempt] = useState<Attempt>("primary");
  const onErrorRef = useRef(onError);
  const previousSrcRef = useRef<string | undefined | symbol>(Symbol("initial-src"));
  const canRetryWithFallback = Boolean(fallbackSrc && fallbackSrc !== src);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (previousSrcRef.current === src) return;
    previousSrcRef.current = src;
    setAttempt("primary");
    if (!src) onErrorRef.current?.();
  }, [src]);

  const handleUnrecoverable = () => {
    setAttempt("failed");
    onError?.();
  };

  const handleFailure = () => {
    if (attempt === "primary" && canRetryWithFallback) {
      setAttempt("fallback");
      return;
    }
    handleUnrecoverable();
  };

  const activeSrc = attempt === "fallback" ? fallbackSrc : src;

  if (attempt === "failed" || !activeSrc) {
    return (
      <div
        role="img"
        aria-label={`${alt}. ${fallbackLabel}`}
        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface-subtle px-4 text-center text-muted-foreground"
      >
        <ImageOff className="h-8 w-8" aria-hidden="true" />
        <span className="text-xs font-medium">{fallbackLabel}</span>
      </div>
    );
  }

  return (
    <Image
      src={activeSrc}
      alt={alt}
      fill
      sizes={sizes}
      className={cn("object-contain", className)}
      loading={loading}
      fetchPriority={fetchPriority}
      quality={quality}
      unoptimized={unoptimized}
      style={style}
      onError={handleFailure}
      onLoad={async (event) => {
        const image = event.currentTarget;
        try {
          if (typeof image.decode === "function") await image.decode();
          onLoad?.();
        } catch {
          handleFailure();
        }
      }}
      draggable={false}
    />
  );
}
