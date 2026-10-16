import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const imageContracts = [
  ["CategoriesList.tsx", '<Image\n              src={category.image}\n              alt=""\n              fill\n              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"\n              unoptimized'],
  ["CategoryForm.tsx", '<Image src={image} alt="" width={160} height={96} unoptimized'],
  ["SubcategoriesList.tsx", '<Image src={sub.image} alt="" width={64} height={48} unoptimized'],
  ["SubcategoryForm.tsx", '<Image src={image} alt="" width={160} height={96} unoptimized'],
] as const;

describe("admin category image delivery", () => {
  it.each(imageContracts)("serves %s directly from Storage instead of through /_next/image", (file, image) => {
    const source = readFileSync(path.join(process.cwd(), "src", "components", "admin", file), "utf8");

    expect(source).toContain(image);
  });
});
