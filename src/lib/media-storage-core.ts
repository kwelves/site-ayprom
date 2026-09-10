export const PUBLIC_MEDIA_BUCKETS = ["product-images", "category-images", "brand-logos", "site-media"] as const;
export type PublicMediaBucket = (typeof PUBLIC_MEDIA_BUCKETS)[number];

export function validateMediaObjectPath(value: string): string {
  if (!value || value.length > 900 || /[\\\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Некорректный путь публичного медиафайла.");
  }
  return value;
}

export function buildR2ObjectKey(bucket: PublicMediaBucket, path: string): string {
  if (!(PUBLIC_MEDIA_BUCKETS as readonly string[]).includes(bucket)) throw new Error("Неизвестный медиабакет.");
  return `${bucket}/${validateMediaObjectPath(path)}`;
}

export function buildR2PublicUrl(base: string, bucket: PublicMediaBucket, path: string): string {
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Некорректный публичный адрес медиа.");
  }
  return `${url.href.replace(/\/+$/, "")}/${buildR2ObjectKey(bucket, path).split("/").map(encodeURIComponent).join("/")}`;
}

export function locatePublicMediaObject(options: {
  publicUrl: string;
  bucket: PublicMediaBucket;
  supabaseUrl: string;
  r2PublicBaseUrl?: string;
}): { provider: "supabase" | "r2"; bucket: PublicMediaBucket; path: string; key: string } | null {
  try {
    const url = new URL(options.publicUrl);
    if (url.username || url.password || url.search || url.hash) return null;
    const origins: Array<["supabase" | "r2", string, string]> = [
      ["supabase", options.supabaseUrl, `/storage/v1/object/public/${options.bucket}/`],
    ];
    if (options.r2PublicBaseUrl) origins.push(["r2", options.r2PublicBaseUrl, `/${options.bucket}/`]);
    for (const [provider, base, suffix] of origins) {
      const baseUrl = new URL(base);
      const prefix = baseUrl.pathname.replace(/\/+$/, "") + suffix;
      if (url.origin !== baseUrl.origin || !url.pathname.startsWith(prefix)) continue;
      const path = validateMediaObjectPath(decodeURIComponent(url.pathname.slice(prefix.length)));
      return { provider, bucket: options.bucket, path, key: buildR2ObjectKey(options.bucket, path) };
    }
  } catch { return null; }
  return null;
}
