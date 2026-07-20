"use client";

import Link from "next/link";
import { AtSign, Mail, MapPin, Truck } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";
import { buildMainNav } from "@/lib/navigation";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import type { Category } from "@/types/catalog";

export function Footer({ categories }: { categories: Category[] }) {
  const handleHashClick = useHashNavClick();
  const mainNav = buildMainNav(categories);

  return (
    <footer id="contacts" className="scroll-mt-16 bg-slate-900 text-slate-300">
      <Reveal>
        <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:py-16">
          <div>
            <Link href="/" className="flex items-center gap-2" onClick={(event) => handleHashClick("/", event)}>
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Truck className="h-5 w-5" />
              </span>
              <span className="text-lg font-bold leading-none text-white">
                AY<span className="text-blue-400">PROM</span>
              </span>
            </Link>
            <p className="mt-4 max-w-xs text-sm text-slate-400">
              Гидрооборудование и запчасти для спецтехники и грузовой техники: подбор по
              категории, марке техники и артикулу.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Навигация</p>
            <ul className="mt-2 flex flex-col">
              {mainNav.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={(event) => handleHashClick(link.href, event)}
                    className="block py-2 text-sm text-slate-300 transition-colors hover:text-blue-400"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Контакты</p>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-slate-300">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-blue-400" />
                <span>Кыргызстан, г. Бишкек, ул. Ден Сяопина, 457/1</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-blue-400" />
                <a href="mailto:info@ayprom.kg" className="py-1.5 hover:text-blue-400">
                  info@ayprom.kg
                </a>
              </li>
              <li className="flex items-center gap-3">
                <AtSign className="h-4 w-4 shrink-0 text-blue-400" />
                <span className="flex items-center gap-2">
                  <a
                    href="https://instagram.com/ayprom.kg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-1.5 hover:text-blue-400"
                  >
                    Instagram
                  </a>
                  <span aria-hidden="true" className="text-slate-600">
                    ·
                  </span>
                  <a
                    href="https://tiktok.com/@ayprom.kg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-1.5 hover:text-blue-400"
                  >
                    TikTok
                  </a>
                </span>
              </li>
              <li>
                <Link href="/contacts" className="py-1.5 text-blue-400 hover:underline">
                  Все контакты и телефоны →
                </Link>
              </li>
            </ul>
          </div>
        </Container>
      </Reveal>

      <div className="border-t border-slate-800">
        <Container className="py-4 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} AYPROM. Все права защищены.
        </Container>
      </div>
    </footer>
  );
}
