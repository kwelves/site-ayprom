const MAX_PRODUCT_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 8_000;
const MAX_IMAGE_PIXELS = 40_000_000;

const ALLOWED_RASTER_IMAGE_TYPES = new Map([
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/webp", new Set(["webp"])],
  ["image/avif", new Set(["avif"])],
]);

export interface ImageDimensions {
  width: number;
  height: number;
}

function text(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  let offset = 2;
  const startOfFrameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 1 >= bytes.length) return null;

    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;

    if (startOfFrameMarkers.has(marker) && segmentLength >= 7) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      };
    }

    offset += segmentLength;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  const chunkType = text(bytes, 12, 4);

  if (chunkType === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }

  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
      height: 1 + (((bytes[24] & 0x0f) << 10) | (bytes[23] << 2) | ((bytes[22] & 0xc0) >> 6)),
    };
  }

  if (chunkType === "VP8 " && bytes.length >= 30 && text(bytes, 23, 3) === "\x9d\x01\x2a") {
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }

  return null;
}

function readAvifDimensions(bytes: Uint8Array): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let largest: ImageDimensions | null = null;

  for (let offset = 4; offset + 15 < bytes.length; offset += 1) {
    if (text(bytes, offset, 4) !== "ispe") continue;

    const width = view.getUint32(offset + 8);
    const height = view.getUint32(offset + 12);
    if (width === 0 || height === 0) continue;
    if (!largest || width * height > largest.width * largest.height) largest = { width, height };
  }

  return largest;
}

export function readRasterImageDimensions(bytes: Uint8Array, mimeType: string): ImageDimensions | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (mimeType === "image/png" && bytes.length >= 24) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (mimeType === "image/jpeg") return readJpegDimensions(bytes);
  if (mimeType === "image/webp") return readWebpDimensions(bytes);
  if (mimeType === "image/avif") return readAvifDimensions(bytes);
  return null;
}

export async function validateProductImage(file: File): Promise<void> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Файл «${file.name}» больше 8 МБ.`);
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const allowedExtensions = ALLOWED_RASTER_IMAGE_TYPES.get(file.type);
  if (!allowedExtensions?.has(extension)) {
    throw new Error(`Файл «${file.name}» должен быть JPEG, PNG, WebP или AVIF с корректным расширением.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  const isWebp = text(bytes, 0, 4) === "RIFF" && text(bytes, 8, 4) === "WEBP";
  const avifBrand = text(bytes, 4, 8);
  const isAvif = avifBrand === "ftypavif" || avifBrand === "ftypavis";
  const signatureMatches =
    (file.type === "image/jpeg" && isJpeg) ||
    (file.type === "image/png" && isPng) ||
    (file.type === "image/webp" && isWebp) ||
    (file.type === "image/avif" && isAvif);

  if (!signatureMatches) {
    throw new Error(`Содержимое файла «${file.name}» не соответствует заявленному формату.`);
  }

  const dimensions = readRasterImageDimensions(bytes, file.type);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    throw new Error(`Не удалось определить разрешение файла «${file.name}».`);
  }
  if (
    dimensions.width > MAX_IMAGE_DIMENSION ||
    dimensions.height > MAX_IMAGE_DIMENSION ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error(`Файл «${file.name}» превышает допустимое разрешение: 8000 px по стороне и 40 Мп.`);
  }
}

export { MAX_PRODUCT_IMAGES };
