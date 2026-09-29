// Decoded display copy of a picture (ADR-359 Amendment 1).
//
// An <img> is decoded lazily. Chromium decodes it, at the size of the draw, on
// the renderer main thread inside the canvas flush, and decodes it again at a
// larger size when a zoom needs more pixels. Each full decode of a 24 MP JPEG
// took 160-670 ms, and zooming in from fit-to-bed needed three of them.
// The canvas therefore draws a copy that createImageBitmap decodes once, from
// the source bytes and off the main thread, capped at a 4096 px edge like the
// adjusted copies (ADR-359 item 6). Until the copy lands, or where it cannot
// be made, the canvas draws the <img> as it always did. Display only.

import { releaseDisplayLevels } from './raster-display-levels';

type Size = { readonly width: number; readonly height: number };

type Entry = {
  bitmap: ImageBitmap | null;
  failed: boolean;
  readonly pixels: number;
  readonly onReady: Set<() => void>;
};

export const MAX_DECODED_DISPLAY_EDGE = 4096;
// Past this many decoded pixels (192 MiB of RGBA, plus a third for the halved
// levels) a further picture keeps drawing its <img>: display only, never a
// refusal.
export const MAX_DECODED_DISPLAY_PIXELS = 48 * 1024 * 1024;

// Keyed by the scene's own source string, whose hash the engine caches, as
// the <img> cache in draw-raster.ts is.
const entries = new Map<string, Entry>();
let reservedPixels = 0;

/**
 * The decoded copy of a picture's source, or null while it is decoding or
 * when it cannot be made, in which case the caller draws `img`. The first
 * call starts the decode; `onReady` runs once when the copy lands.
 */
export function decodedRasterDisplay(
  sourceKey: string,
  img: HTMLImageElement,
  onReady?: () => void,
): ImageBitmap | null {
  const existing = entries.get(sourceKey);
  if (existing !== undefined) {
    if (existing.bitmap === null && !existing.failed && onReady !== undefined) {
      existing.onReady.add(onReady);
    }
    return existing.bitmap;
  }
  if (typeof createImageBitmap !== 'function' || typeof Blob === 'undefined') return null;
  const natural = { width: img.naturalWidth, height: img.naturalHeight };
  const size = decodedDisplaySize(natural);
  const pixels = size.width * size.height;
  if (pixels <= 0 || reservedPixels + pixels > MAX_DECODED_DISPLAY_PIXELS) return null;
  const entry: Entry = { bitmap: null, failed: false, pixels, onReady: new Set() };
  if (onReady !== undefined) entry.onReady.add(onReady);
  entries.set(sourceKey, entry);
  reservedPixels += pixels;
  // A later task, so the frame that asked paints the <img> without waiting on
  // the source bytes being decoded from base64.
  setTimeout(() => {
    decodeDisplayBitmap(sourceKey, size, natural).then(
      (bitmap) => settle(sourceKey, entry, bitmap),
      () => settle(sourceKey, entry, null),
    );
  }, 0);
  return null;
}

/** Drops the copies of sources no live object draws as they are. */
export function pruneDecodedRasterDisplays(live: ReadonlySet<string>): void {
  for (const [sourceKey, entry] of entries) {
    if (live.has(sourceKey)) continue;
    entries.delete(sourceKey);
    discard(entry);
  }
}

export function resetDecodedRasterDisplaysForTests(): void {
  pruneDecodedRasterDisplays(new Set());
  reservedPixels = 0;
}

/** The size of the decoded copy: the oriented natural size, capped. */
export function decodedDisplaySize(natural: Size): Size {
  const longest = Math.max(natural.width, natural.height);
  if (!(natural.width > 0 && natural.height > 0 && Number.isFinite(longest))) {
    return { width: 0, height: 0 };
  }
  const scale = Math.min(1, MAX_DECODED_DISPLAY_EDGE / longest);
  return {
    width: Math.max(1, Math.round(natural.width * scale)),
    height: Math.max(1, Math.round(natural.height * scale)),
  };
}

async function decodeDisplayBitmap(
  sourceKey: string,
  size: Size,
  natural: Size,
): Promise<ImageBitmap | null> {
  const blob = base64DataUrlBlob(sourceKey);
  if (blob === null) return null;
  const resized = size.width !== natural.width || size.height !== natural.height;
  // The <img> draws turned by the EXIF Orientation, so the copy must too.
  const bitmap = await createImageBitmap(
    blob,
    resized
      ? {
          imageOrientation: 'from-image',
          resizeWidth: size.width,
          resizeHeight: size.height,
          resizeQuality: 'low',
        }
      : { imageOrientation: 'from-image' },
  );
  if (bitmap.width === size.width && bitmap.height === size.height) return bitmap;
  // An engine that ignored the orientation or the resize: keep the <img>.
  bitmap.close();
  return null;
}

function settle(sourceKey: string, entry: Entry, bitmap: ImageBitmap | null): void {
  if (entries.get(sourceKey) !== entry) {
    bitmap?.close();
    return;
  }
  const callbacks = [...entry.onReady];
  entry.onReady.clear();
  if (bitmap === null) {
    entry.failed = true;
    reservedPixels -= entry.pixels;
    return;
  }
  entry.bitmap = bitmap;
  for (const callback of callbacks) callback();
}

function discard(entry: Entry): void {
  entry.onReady.clear();
  if (!entry.failed) reservedPixels -= entry.pixels;
  if (entry.bitmap === null) return;
  releaseDisplayLevels(entry.bitmap);
  entry.bitmap.close();
  entry.bitmap = null;
}

// Not fetch(): production CSP's connect-src blocks data: URLs (image-loader.ts).
function base64DataUrlBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:') || comma < 0) return null;
  const header = dataUrl.slice('data:'.length, comma).split(';');
  if (header.at(-1)?.toLowerCase() !== 'base64') return null;
  try {
    return new Blob([base64Bytes(dataUrl.slice(comma + 1))], { type: header[0] ?? '' });
  } catch {
    return null;
  }
}

type Base64Decoder = (base64: string) => Uint8Array<ArrayBuffer>;

function base64Bytes(base64: string): Uint8Array<ArrayBuffer> {
  // Native where the engine has it: a quarter of atob's cost on a 10 MB photo.
  const native = (Uint8Array as unknown as { readonly fromBase64?: Base64Decoder }).fromBase64;
  if (typeof native === 'function') return native(base64);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
