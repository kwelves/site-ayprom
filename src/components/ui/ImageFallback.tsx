"use client";

import { useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImageFallbackProps {
  src?: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
  quality?: number;
  style?: React.CSSProperties;
  fallbackLabel?: string;
  onLoad?: () => void;
}

export function ImageFallback({
  src,
  alt,
  sizes,
  className,
  priority,
  quality,
  style,
  fallbackLabel = "Фотография пока не добавлена",
  onLoad,
}: ImageFallbackProps) {
  const [failed, setFailed] = useState(false);

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
      priority={priority}
      quality={quality}
      style={style}
      onError={() => setFailed(true)}
      onLoad={onLoad}
      draggable={false}
    />
  );
}
