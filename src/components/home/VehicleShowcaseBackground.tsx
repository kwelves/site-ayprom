"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { useReducedMotion } from "framer-motion";

const posterSrc = "/images/vehicle-showcase-poster.webp";

export function VehicleShowcaseBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const video = videoRef.current;

    if (!video || shouldReduceMotion) {
      video?.pause();
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void video.play().catch(() => undefined);
        } else {
          video.pause();
        }
      },
      { threshold: 0.05 },
    );

    observer.observe(video);
    return () => observer.disconnect();
  }, [shouldReduceMotion]);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-slate-950">
      <Image
        src={posterSrc}
        alt=""
        fill
        sizes="100vw"
        className="object-cover"
      />

      {!shouldReduceMotion && (
        <video
          ref={videoRef}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={posterSrc}
          className="absolute inset-0 h-full w-full scale-[1.01] object-cover blur-[1.2px]"
        >
          <source src="/videos/vehicle-showcase-background.mp4" type="video/mp4" />
        </video>
      )}

      <div className="absolute inset-0 bg-slate-950/58" />
      <div className="absolute inset-0 bg-linear-to-b from-slate-950/50 via-transparent to-slate-950/65" />
    </div>
  );
}
