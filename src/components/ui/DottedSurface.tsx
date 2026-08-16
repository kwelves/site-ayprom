"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

type DottedSurfaceProps = Omit<React.ComponentProps<"div">, "ref"> & {
  size?: number;
  opacity?: number;
  sizeAttenuation?: boolean;
};

const SEPARATION = 150;
const AMOUNTX = 40;
const AMOUNTY = 30;
// Light, low-saturation dots read against the footer's dark bg-inverse surface.
const DOT_COLOR: [number, number, number] = [200, 210, 230];

// Decorative animated dot grid, scoped to fill its positioned parent (the
// footer) rather than the whole viewport — sized off the container's own
// box via ResizeObserver instead of window.innerWidth/innerHeight.
export function DottedSurface({ className, size = 8, opacity = 0.8, sizeAttenuation = true, ...props }: DottedSurfaceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || prefersReducedMotion) return;

    let width = container.clientWidth;
    let height = container.clientHeight;
    if (width === 0 || height === 0) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, width / height, 1, 10000);
    camera.position.set(0, 355, 1220);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const positions: number[] = [];
    const colors: number[] = [];
    for (let ix = 0; ix < AMOUNTX; ix++) {
      for (let iy = 0; iy < AMOUNTY; iy++) {
        positions.push(ix * SEPARATION - (AMOUNTX * SEPARATION) / 2, 0, iy * SEPARATION - (AMOUNTY * SEPARATION) / 2);
        colors.push(...DOT_COLOR);
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size,
      vertexColors: true,
      transparent: true,
      opacity,
      sizeAttenuation,
    });

    const points = new THREE.Points(geometry, material);
    scene.add(points);

    let count = 0;
    let animationId = 0;

    const animate = () => {
      animationId = requestAnimationFrame(animate);

      const positionArray = geometry.attributes.position.array as Float32Array;
      let i = 0;
      for (let ix = 0; ix < AMOUNTX; ix++) {
        for (let iy = 0; iy < AMOUNTY; iy++) {
          positionArray[i * 3 + 1] = Math.sin((ix + count) * 0.3) * 50 + Math.sin((iy + count) * 0.5) * 50;
          i++;
        }
      }
      geometry.attributes.position.needsUpdate = true;

      renderer.render(scene, camera);
      count += 0.1;
    };

    // Footer sits below the fold on most pages — keep the WebGL loop paused
    // until it actually scrolls into view, and pause it again once it scrolls
    // back out, instead of rendering every frame for the whole page visit.
    const visibilityObserver = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!animationId) animate();
        } else {
          cancelAnimationFrame(animationId);
          animationId = 0;
        }
      },
      { threshold: 0 },
    );
    visibilityObserver.observe(container);

    const resizeObserver = new ResizeObserver(() => {
      width = container.clientWidth;
      height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);

    return () => {
      visibilityObserver.disconnect();
      resizeObserver.disconnect();
      cancelAnimationFrame(animationId);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [size, opacity, sizeAttenuation, prefersReducedMotion]);

  if (prefersReducedMotion) return null;

  return <div ref={containerRef} className={cn("pointer-events-none absolute inset-0", className)} {...props} />;
}

export default DottedSurface;
