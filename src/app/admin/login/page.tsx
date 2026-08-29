import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginPasswordInput } from "@/components/admin/LoginPasswordInput";
import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";
import { login } from "@/lib/admin/actions";

export const metadata: Metadata = {
  title: "Вход — Админка AYPROM",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string; retry?: string; changed?: string; session?: string }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const { error, retry, changed, session } = await searchParams;
  const parsedRetry = Number(retry ?? 0);
  const retryMinutes = Number.isFinite(parsedRetry) ? Math.max(1, Math.ceil(parsedRetry / 60)) : 15;

  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-4">
      <form action={login} className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-lg font-semibold text-card-foreground">Вход в админку</h1>

        <label className="mt-6 block text-sm">
          <span className="text-muted-foreground">Пароль</span>
          <LoginPasswordInput />
        </label>

        {error === "rate" ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            Слишком много попыток. Повторите вход примерно через {retryMinutes} мин.
          </p>
        ) : error === "security" ? (
          <p className="mt-3 text-sm text-danger" role="alert">
            Защита входа временно недоступна. Повторите попытку через несколько секунд.
          </p>
        ) : (
          error && (
            <p className="mt-3 text-sm text-danger" role="alert">
              Неверный пароль. Проверьте ввод и повторите попытку.
            </p>
          )
        )}

        {changed === "1" && (
          <p className="mt-3 text-sm text-success" role="status">
            Пароль изменён. Войдите с новым паролем.
          </p>
        )}

        {session === "expired" && (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Сессия завершена после смены пароля. Войдите снова.
          </p>
        )}

        {session === "unavailable" && (
          <p className="mt-3 text-sm text-danger" role="alert">
            Не удалось проверить сессию. Повторите вход через несколько секунд.
          </p>
        )}

        <LoginSubmitButton />

        <Link
          href="/"
          className="mt-2 flex items-center justify-center gap-1.5 rounded-md py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:py-0"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Вернуться на сайт
        </Link>
      </form>
    </main>
  );
}
