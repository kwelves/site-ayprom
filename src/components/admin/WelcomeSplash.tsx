"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Truck } from "lucide-react";

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
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        <Truck className="h-8 w-8" />
      </motion.span>
      <motion.div
        initial={{ y: 8, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15, ease: "easeOut" }}
      >
        <h1 className="text-xl font-semibold text-foreground">Здравствуйте, шеф</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Загружаем панель управления...</p>
      </motion.div>
    </div>
  );
}
