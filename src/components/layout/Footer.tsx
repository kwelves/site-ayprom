"use client";

import Image from "next/image";
import Link from "next/link";
import { AtSign, Mail, MapPin } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Reveal } from "@/components/motion/Reveal";
import { buildMainNav } from "@/lib/navigation";
import { useHashNavClick } from "@/lib/use-hash-nav-click";
import type { Brand, Category } from "@/types/catalog";

export function Footer({ categories, brands }: { categories: Category[]; brands: Brand[] }) {
  const handleHashClick = useHashNavClick();
  const mainNav = buildMainNav(categories, brands);

  return (
    <footer id="contacts" className="scroll-mt-16 bg-inverse text-inverse-foreground-muted">
      <Reveal>
        <Container className="grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-3 lg:py-16">
          <div>
            <Link href="/" className="inline-flex" onClick={(event) => handleHashClick("/", event)}>
              <Image
                src="/brand/ayprom-logo.svg"
                alt="AYPROM"
                width={378}
                height={90}
                className="h-10 w-auto object-contain"
                unoptimized
              />
            </Link>
            <p className="mt-4 max-w-xs text-sm text-inverse-foreground-subtle">
              Гидрооборудование и запчасти для спецтехники и грузовой техники: подбор по
              категории, марке техники и артикулу.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-inverse-foreground-subtle">Навигация</p>
            <ul className="mt-2 flex flex-col">
              {mainNav.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={(event) => handleHashClick(link.href, event)}
                    className="block py-2 text-sm text-inverse-foreground-muted transition-colors duration-fast ease-ui hover:text-inverse-accent"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-inverse-foreground-subtle">Контакты</p>
            <ul className="mt-4 flex flex-col gap-3 text-sm text-inverse-foreground-muted">
              <li className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-inverse-accent" />
                <span>Кыргызстан, г. Бишкек, пр. Дэн Сяопина, 457/1</span>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="h-4 w-4 shrink-0 text-inverse-accent" />
                <a href="mailto:info@ayprom.kg" className="py-1.5 transition-colors duration-fast ease-ui hover:text-inverse-accent">
                  info@ayprom.kg
                </a>
              </li>
              <li className="flex items-center gap-3">
                <AtSign className="h-4 w-4 shrink-0 text-inverse-accent" />
                <span className="flex items-center gap-2">
                  <a
                    href="https://instagram.com/ayprom.kg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-1.5 transition-colors duration-fast ease-ui hover:text-inverse-accent"
                  >
                    Instagram
                  </a>
                  <span aria-hidden="true" className="text-inverse-foreground-subtle">
                    ·
                  </span>
                  <a
                    href="https://tiktok.com/@ayprom.kg"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-1.5 transition-colors duration-fast ease-ui hover:text-inverse-accent"
                  >
                    TikTok
                  </a>
                </span>
              </li>
              <li>
                <Link href="/contacts" className="py-1.5 text-inverse-accent transition-colors duration-fast ease-ui hover:underline">
                  Все контакты и телефоны →
                </Link>
              </li>
            </ul>
          </div>
        </Container>
      </Reveal>

      <div className="border-t border-inverse-border">
        <Container className="py-4 text-center text-xs text-inverse-foreground-subtle">
          © {new Date().getFullYear()} AYPROM. Все права защищены.
        </Container>
      </div>
    </footer>
  );
}
