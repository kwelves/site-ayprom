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

// A photo that fails twice in a row (variant, then master) is tried again after a short pause, three times, with a
// cache-busting parameter: a dropped connection or a half-written response must not leave a broken picture.
const RETRY_DELAYS_MS = [500, 1500, 3500] as const;

function withRetryParameter(url: string | undefined, retry: number): string | undefined {
  if (!url || retry === 0) return url;
  const hashAt = url.indexOf("#");
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? "" : url.slice(hashAt);
  return `${base}${base.includes("?") ? "&" : "?"}_r=${retry}${hash}`;
}

export function ImageFallback(props: ImageFallbackProps) {
  return <ImageFallbackAttempt key={`${props.src ?? ""}\u0000${props.fallbackSrc ?? ""}`} {...props} />;
}

function ImageFallbackAttempt({
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
  const [retry, setRetry] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onErrorRef = useRef(onError);
  const canRetryWithFallback = Boolean(fallbackSrc && fallbackSrc !== src);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (!src) onErrorRef.current?.();
  }, [src]);

  useEffect(() => () => { if (retryTimer.current) clearTimeout(retryTimer.current); }, []);

  const handleUnrecoverable = () => {
    setAttempt("failed");
    onError?.();
  };

  const handleFailure = () => {
    if (attempt === "primary" && canRetryWithFallback) {
      setAttempt("fallback");
      return;
    }
    if (retry < RETRY_DELAYS_MS.length) {
      setWaiting(true);
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        setRetry((current) => current + 1);
        setAttempt("primary");
        setWaiting(false);
      }, RETRY_DELAYS_MS[retry]);
      return;
    }
    handleUnrecoverable();
  };

  const activeSrc = withRetryParameter(attempt === "fallback" ? fallbackSrc : src, retry);

  if (waiting) return null;

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
      key={`${activeSrc}#${retry}`}
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
