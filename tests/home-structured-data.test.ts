import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { buildHomeStructuredData } from "@/lib/home-structured-data";
import { HOME_SEO_DESCRIPTION } from "@/lib/home-seo";

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

afterEach(() => {
  if (originalSiteUrl === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  } else {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  }
});

describe("home structured data", () => {
  it("связывает сайт и локальный бизнес с каноническими данными AYPROM", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.ayprom-gidravlika.kg/";

    const data = buildHomeStructuredData() as {
      "@graph": Array<Record<string, unknown>>;
    };
    const website = data["@graph"].find((entry) => entry["@type"] === "WebSite");
    const business = data["@graph"].find((entry) => entry["@type"] === "AutoPartsStore");

    expect(website).toMatchObject({
      "@id": "https://www.ayprom-gidravlika.kg/#website",
      url: "https://www.ayprom-gidravlika.kg",
      name: "AYPROM",
      alternateName: ["Айпром", "AYPROM Гидравлика", "Айпром Гидравлика", "ayprom-gidravlika.kg"],
      description: HOME_SEO_DESCRIPTION,
      publisher: { "@id": "https://www.ayprom-gidravlika.kg/#organization" },
    });
    expect(business).toMatchObject({
      "@id": "https://www.ayprom-gidravlika.kg/#organization",
      url: "https://www.ayprom-gidravlika.kg",
      name: "AYPROM",
      alternateName: ["Айпром", "AYPROM Гидравлика", "Айпром Гидравлика"],
      description: HOME_SEO_DESCRIPTION,
      telephone: "+996500461155",
      contactPoint: {
        "@type": "ContactPoint",
        telephone: "+996500461155",
        contactType: "sales",
        availableLanguage: ["ru", "ky"],
      },
      address: {
        addressCountry: "KG",
        addressLocality: "Бишкек",
        streetAddress: "пр. Дэн Сяопина, 457/1",
      },
      logo: {
        url: "https://www.ayprom-gidravlika.kg/brand/ayprom-icon-square.png",
        width: 512,
        height: 512,
      },
      hasMap: "https://go.2gis.com/NEFoK",
    });
    expect(business?.sameAs).toEqual(
      expect.arrayContaining([
        "https://instagram.com/ayprom.kg",
        "https://tiktok.com/@ayprom.kg",
        "https://2gis.kg/bishkek/firm/70000001102769110",
        "https://yandex.com/maps/org/ayprom/169874849937/",
      ]),
    );
  });

  it("использует доступный квадратный логотип 512 на 512 пикселей", async () => {
    const iconPath = path.join(process.cwd(), "public", "brand", "ayprom-icon-square.png");
    const metadata = await sharp(iconPath).metadata();

    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });
});
