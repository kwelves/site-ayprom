import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AboutPreview } from "@/components/site/AboutPreview";
import {
  HOME_METADATA,
  HOME_HERO_TITLE,
  HOME_SEO_DESCRIPTION,
  HOME_SEO_FULL_TITLE,
  HOME_SEO_TITLE,
} from "@/lib/home-seo";

describe("главная страница в поиске", () => {
  it("согласует title с предложением в Hero и сохраняет бренд AYPROM", () => {
    expect(HOME_SEO_TITLE).toBe("Гидравлические запчасти для спецтехники");
    expect(HOME_SEO_FULL_TITLE).toBe("Гидравлические запчасти для спецтехники — AYPROM");
    expect(HOME_HERO_TITLE).toBe("AYPROM - гидравлические запчасти для спецтехники");
    expect(HOME_HERO_TITLE).not.toContain("Бишкек");
    expect(HOME_SEO_FULL_TITLE).not.toContain("Бишкек");
    expect(HOME_SEO_FULL_TITLE.length).toBeLessThanOrEqual(60);
    expect(HOME_SEO_DESCRIPTION.length).toBeLessThanOrEqual(160);

    expect(HOME_METADATA).toMatchObject({
      title: { absolute: HOME_SEO_FULL_TITLE },
      description: HOME_SEO_DESCRIPTION,
      alternates: { canonical: "/" },
      openGraph: {
        siteName: "AYPROM",
        title: HOME_SEO_FULL_TITLE,
        description: HOME_SEO_DESCRIPTION,
        url: "/",
      },
      twitter: {
        title: HOME_SEO_FULL_TITLE,
        description: HOME_SEO_DESCRIPTION,
      },
    });
  });

  it("оставляет продающий текст доступным для сниппета, а справочные карточки исключает", () => {
    const markup = renderToStaticMarkup(<AboutPreview />);

    expect(markup).toContain(HOME_SEO_DESCRIPTION);
    expect(markup.match(/data-nosnippet=""/g)).toHaveLength(2);
    expect(markup).toContain("г. Бишкек, пр. Дэн Сяопина, 457/1");
  });
});
