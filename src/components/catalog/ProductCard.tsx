import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/types/catalog";

// Unlike CategoryCard/BrandCard (which lift + scale on hover), product cards
// use a static hover — only border/shadow change, no transform. In a long
// product grid a moving card under every pointer pass would be visual noise
// while scanning, so the card stays put and just signals "interactive".
// `href` is passed in because the same card links to different nested paths
// depending on whether it's shown under a subcategory grid or a brand grid.
export function ProductCard({ product, href }: { product: Product; href: string }) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-blue-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <div className="relative aspect-4/3 w-full shrink-0 bg-muted/40">
        <Image
          src={product.images[0]}
          alt={product.name}
          fill
          sizes="(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px"
          className="object-contain p-4"
        />
      </div>

      <div className="flex flex-1 flex-col px-4 pt-4 pb-5">
        <span className="text-sm font-semibold text-card-foreground">{product.name}</span>
        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {product.shortDescription}
        </p>
      </div>
    </Link>
  );
}
