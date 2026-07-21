import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { login } from "@/lib/admin/actions";

export const metadata: Metadata = {
  title: "Вход — Админка AYPROM",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-4">
      <form action={login} className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-card-foreground">Вход в админку</h1>

        <label className="mt-6 block text-sm">
          <span className="text-slate-600">Пароль</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="mt-1.5 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600">Неверный пароль.</p>}

        <button
          type="submit"
          className="mt-6 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Войти
        </button>

        <Link
          href="/"
          className="mt-4 flex items-center justify-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Вернуться на сайт
        </Link>
      </form>
    </div>
  );
}
