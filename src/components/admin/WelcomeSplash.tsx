"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";

const REDIRECT_DELAY_MS = 1400;

// Shown only right after a successful login (see login() redirecting here in
// actions.ts) — a brief, purely cosmetic pause before landing on the products
// list, not a route the admin should be able to navigate back to.
export function WelcomeSplash() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/admin/products"), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
      {/* Появление один раз при монтировании, без ухода — здесь framer-motion
          нечего делать, хватает классов. Старт с 0.94, а не с 0.6: слишком
          мелкий старт читается как прыжок, а не как появление. */}
      <span className="flex h-16 w-16 animate-pop-in items-center justify-center rounded-full bg-brand p-3">
        <Image
          src="/brand/ayprom-icon.svg"
          alt=""
          width={102}
          height={90}
          className="h-full w-full object-contain"
          unoptimized
        />
      </span>
      <div className="animate-fade-up [animation-delay:150ms]">
        <h1 className="text-xl font-semibold text-foreground">Здравствуйте, шеф</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Загружаем панель управления...</p>
      </div>
    </div>
  );
}
