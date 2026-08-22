"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageFallbackProps {
  src?: string;
  alt: string;
  sizes: string;
  className?: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
  quality?: number;
  style?: React.CSSProperties;
  fallbackLabel?: string;
  onLoad?: () => void;
  onError?: () => void;
}

export function ImageFallback({
  src,
  alt,
  sizes,
  className,
  loading,
  fetchPriority,
  quality,
  style,
  fallbackLabel = "Фотография пока не добавлена",
  onLoad,
  onError,
}: ImageFallbackProps) {
  const [failed, setFailed] = useState(false);
  const onErrorRef = useRef(onError);
  const previousSrcRef = useRef<string | undefined | symbol>(Symbol("initial-src"));

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    if (previousSrcRef.current === src) return;
    previousSrcRef.current = src;
    if (!src) onErrorRef.current?.();
  }, [src]);

  if (failed || !src) {
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
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      className={cn("object-contain", className)}
      loading={loading}
      fetchPriority={fetchPriority}
      quality={quality}
      style={style}
      onError={() => {
        setFailed(true);
        onError?.();
      }}
      onLoad={onLoad}
      draggable={false}
    />
  );
}
