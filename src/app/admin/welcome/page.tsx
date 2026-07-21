import type { Metadata } from "next";
import { WelcomeSplash } from "@/components/admin/WelcomeSplash";

export const metadata: Metadata = {
  title: "Добро пожаловать — Админка AYPROM",
};

// Reached only right after a successful login (see login() in actions.ts) —
// middleware already gates /admin/:path* except /admin/login, so anyone who
// lands here already has a valid session; no separate check needed.
export default function AdminWelcomePage() {
  return <WelcomeSplash />;
}
