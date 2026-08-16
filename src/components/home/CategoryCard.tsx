import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface CategoryCardProps {
  href: string;
  image: string;
  name: string;
  sizes?: string;
  nameClassName?: string;
  imageClassName?: string;
}

export function CategoryCard({
  href,
  image,
  name,
  sizes = "(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px",
  nameClassName,
  imageClassName,
}: CategoryCardProps) {
  return (
    // Подъём под курсором — CSS, а не whileHover: сетка карточек поднимала по
    // аниматору framer-motion на каждую плитку, все на главном потоке. Вариант
    // `hover:` в Tailwind v4 уже под `@media (hover: hover)`, поэтому на
    // телефоне карточка больше не остаётся увеличенной после тапа.
    <Link
      href={href}
      className="group relative z-0 flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-[border-color,translate,scale] duration-fast ease-ui hover:z-10 hover:-translate-y-1 hover:scale-[1.03] hover:border-border-interactive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
    >
      {/* Extra internal padding keeps the product smaller within the frame so the
          card reads airier now that it's just a photo + caption. */}
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <Image src={image} alt={name} fill sizes={sizes} className={cn("object-contain p-5", imageClassName)} />
      </div>

      <div className="px-4 py-3.5 text-center">
        <span className={cn("text-base font-medium text-card-foreground", nameClassName)}>{name}</span>
      </div>
    </Link>
  );
}
