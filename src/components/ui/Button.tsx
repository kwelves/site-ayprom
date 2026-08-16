"use client";

import Link from "next/link";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Нажатие — обычный CSS, а не whileHover/whileTap:
//   * `transform` через класс считается композитором, тогда как Framer
//     анимирует сокращённый `scale` покадрово на главном потоке — а кнопка
//     на странице не одна;
//   * `prefers-reduced-motion` глушится общим правилом в globals.css, ручная
//     проверка useReducedMotion больше не нужна.
// Наведения на scale нет намеренно: рост кнопки под курсором не даёт
// пользы, а на «Все товары» дёргался при каждом проходе мыши; на сенсорных
// экранах то же состояние залипает после тапа, пока фокус не снимут. Оставлено
// только лёгкое сжатие при нажатии — оно и есть обратная связь «услышали».
// Список свойств перечислен явно: `transition-transform` перебил бы
// `transition-colors`, а не дополнил его. `scale`/`translate` в Tailwind v4 —
// самостоятельные CSS-свойства, а не части `transform`, поэтому названы прямо.
const buttonStyles = cva(
  "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-[color,background-color,border-color,scale] duration-fast ease-ui active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary-hover",
        secondary: "border border-input bg-secondary text-secondary-foreground hover:bg-muted",
      },
      size: {
        default: "h-11 px-5 text-sm",
        sm: "h-9 px-4 text-sm",
        lg: "h-12 px-6 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  }
);

interface ButtonProps extends VariantProps<typeof buttonStyles> {
  children: React.ReactNode;
  className?: string;
  href?: string;
  type?: "button" | "submit";
  onClick?: (event: React.MouseEvent) => void;
}

export function Button({ href, type = "button", variant, size, className, children, onClick }: ButtonProps) {
  const classes = cn(buttonStyles({ variant, size }), className);

  if (href) {
    return (
      <Link href={href} className={classes} onClick={onClick}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} onClick={onClick}>
      {children}
    </button>
  );
}
