import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LoginPasswordInput } from "@/components/admin/LoginPasswordInput";
import { LoginSubmitButton } from "@/components/admin/LoginSubmitButton";
import { AdminMark } from "@/components/admin/ui/AdminMark";
import { login } from "@/lib/admin/actions";

export const metadata: Metadata = {
  title: "Вход — Админка AYPROM",
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string; retry?: string; changed?: string; session?: string }>;
}

function loginMessage({ error, retryMinutes, changed, session }: { error?: string; retryMinutes: number; changed?: string; session?: string }) {
  if (error === "rate") return { tone: "danger", text: `Слишком много попыток. Повторите вход примерно через ${retryMinutes} мин.` } as const;
  if (error === "security") return { tone: "danger", text: "Защита входа временно недоступна. Повторите попытку через несколько секунд." } as const;
  if (error) return { tone: "danger", text: "Неверный пароль. Проверьте раскладку и повторите попытку." } as const;
  if (session === "unavailable") return { tone: "danger", text: "Не удалось проверить сессию. Повторите вход через несколько секунд." } as const;
  if (changed === "1") return { tone: "success", text: "Пароль изменён. Войдите с новым паролем." } as const;
  if (session === "expired") return { tone: "muted", text: "Сессия завершена после смены пароля. Войдите снова." } as const;
  return null;
}

const MESSAGE_TONE = {
  danger: "border-danger-border bg-danger-surface text-danger",
  success: "border-success-border bg-success-surface text-success",
  muted: "border-border bg-surface-subtle text-muted-foreground",
} as const;

export default async function AdminLoginPage({ searchParams }: LoginPageProps) {
  const { error, retry, changed, session } = await searchParams;
  const parsedRetry = Number(retry ?? 0);
  const retryMinutes = Number.isFinite(parsedRetry) ? Math.max(1, Math.ceil(parsedRetry / 60)) : 15;
  const message = loginMessage({ error, retryMinutes, changed, session });

  return (
    <main className="flex min-h-dvh flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-[400px] animate-pop-in">
        <form action={login} className="glass-float rounded-[22px] p-6 sm:p-8">
          <AdminMark variant="logo" size="lg" decorative={false} />

          <h1 className="mt-7 text-[22px] font-semibold tracking-[-0.02em] text-foreground">Вход в админку</h1>
          <p className="mt-1 text-sm text-muted-foreground">Каталог сайта ayprom-gidravlika.kg</p>

          <label className="mt-5 block">
            <span className="text-[13px] font-medium text-foreground">Пароль</span>
            <LoginPasswordInput invalid={Boolean(error)} />
          </label>

          <div id="login-status">
            {message && (
              <p
                role={message.tone === "danger" ? "alert" : "status"}
                className={`mt-3 animate-fade-up rounded-[10px] border px-3 py-2 text-sm ${MESSAGE_TONE[message.tone]}`}
              >
                {message.text}
              </p>
            )}
          </div>

          <LoginSubmitButton />
        </form>

        <Link
          href="/"
          className="mx-auto mt-4 flex w-fit items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-fast ease-ui hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-primary/30"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Вернуться на сайт
        </Link>
      </div>
    </main>
  );
}
