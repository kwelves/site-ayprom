// Одна карточка предпросмотра на весь сайт: её показывают WhatsApp, Telegram,
// Instagram и соцсети при отправке любой ссылки. Размер 1200×630 — то, что
// ожидают og:image и twitter:card="summary_large_image"; квадратный логотип
// они обрезают в мелкую иконку вместо крупной карточки.
export const OG_IMAGE = {
  url: "/brand/ayprom-og.png",
  width: 1200,
  height: 630,
  alt: "AYPROM — гидравлика и запчасти для спецтехники",
} as const;
