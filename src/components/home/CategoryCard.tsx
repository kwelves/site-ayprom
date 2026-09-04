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
    <Link
      href={href}
      data-hover-border-item
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-transform duration-fast ease-ui focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-[0.98]"
    >
      {/* Extra internal padding keeps the product smaller within the frame so the
          card reads airier now that it's just a photo + caption. */}
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <Image
          src={image}
          alt={name}
          fill
          unoptimized
          sizes={sizes}
          className={cn("object-contain p-5", imageClassName)}
        />
      </div>

      <div className="px-4 py-3.5 text-center">
        <span data-card-title className={cn("text-base font-medium text-card-foreground", nameClassName)}>
          {name}
        </span>
      </div>
    </Link>
  );
}
