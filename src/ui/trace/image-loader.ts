// Phase E image loader — decodes a PNG/JPG file into ImageData
// suitable for traceImageToSvgString.
//
// Browser-only: uses an offscreen canvas to rasterize the image and
// pull its pixel buffer. Caller (ImportImageDialog) holds the File
// blob and awaits this loader before kicking off tracing.

import { resampleBuffer } from '../../core/image-resample';
import type { RawImageData } from '../../core/trace';
import { freezeGif, isGif } from '../import/freeze-gif';
import { readImageHeader } from './image-header-reader';
import {
  orientationCanvasTransform,
  orientationSwapsAxes,
  orientedDimensions,
  parseJpegHeader,
  type ExifOrientation,
} from './jpeg-header';
import {
  awaitTraceSignal,
  checkTraceSignal,
  isTraceAbort,
  traceAbortError,
} from './trace-cancellation';

// Cap on the longest image edge after decode, in pixels. Two competing
// forces: trace runtime is O(width × height × colors) (imagetracerjs and
// potrace both), so an unbounded decode makes tracing a large photo crawl;
// but a cap that is too LOW throws away the resolution small features —
// especially small TEXT — need, so they trace as faceted, wavy curves: the
// "langebaan" small-text defect (docs/research/burn-perfection-small-text.md
// Cause B; ADR-037). 2048 (was 1024) doubles the linear resolution — 4× the
// pixels, ~4× the trace time — recovering small-feature fidelity while staying
// interactive on modest hardware in the trace Worker.
//
// RAISING this is registration- and size-safe because every trace result carries
// the actual working grid used by its paths. The imported burn bitmap may retain
// a larger grid (up to BURN_MAX_EDGE_PX); placement maps trace-grid coordinates
// across the bitmap's physical bounds, and boundary boxes are remapped from the
// burn grid to this working grid. Only recovered detail density changes.
// We intentionally do NOT upscale BELOW the source's own size: bilinear-
// upscaling deliberate pixel art (the Sharp preset) would blur the very
// notches the user wants kept. Larger inputs are downsampled proportionally.
const MAX_EDGE_PX = 2048;
// Preview and commit use the same cap so the dialog does not preview one
// pixel grid and then commit a different trace.
export const PREVIEW_MAX_EDGE_PX = MAX_EDGE_PX;

// A burn image is not a trace preview. Keep enough source detail for the
// requested engraving grid while bounding the decoded RGB/luma allocation.
// The total-pixel cap matters for very wide panoramas even when each edge is
// individually reasonable.
export const BURN_MAX_EDGE_PX = 8192;
export const BURN_MAX_SOURCE_PIXELS = 32_000_000;

export function burnDecodeMaxEdge(naturalWidth: number, naturalHeight: number): number {
  const width = Math.max(1, Math.floor(naturalWidth));
  const height = Math.max(1, Math.floor(naturalHeight));
  const sourcePixels = width * height;
  if (sourcePixels <= BURN_MAX_SOURCE_PIXELS) return BURN_MAX_EDGE_PX;
  const pixelScale = Math.sqrt(BURN_MAX_SOURCE_PIXELS / sourcePixels);
  return Math.max(1, Math.min(BURN_MAX_EDGE_PX, Math.floor(Math.max(width, height) * pixelScale)));
}

const PAPER_WHITE = 255;
// The PLATFORM's real 2D-canvas ceiling, measured in Chromium rather than
// assumed: a 16384x16384 OffscreenCanvas allocates, draws and reads back;
// 16385x16385 fails outright. Above these the browser factually cannot
// rasterize the image, which is the integrity category rule 7 / ADR-228 allows
// to refuse (and ADR-268 kept for non-finite coordinates).
//
// Both previous numbers were wrong, in opposite directions. The pixel cap was
// 100_000_000 — 2.7x STRICTER than the platform, so a 12000x9000 PNG of just
// 2 MB was refused with "too large to decode safely" even though Chromium
// builds that exact canvas without complaint; that was a policy cap wearing an
// integrity label. The edge cap was 32_768 — twice as PERMISSIVE as the real
// limit, so an image the canvas genuinely cannot take passed this check and
// failed later somewhere less explicable.
const MAX_SAFE_DECODE_EDGE_PX = 16_384;
const MAX_SAFE_DECODE_PIXELS = 268_435_456;

export type ImageDimensions = { readonly width: number; readonly height: number };

// What the header says before any decode. `oriented` is the size a browser
// displays and decodes (EXIF Orientation applied); it is the only size the
// cap, the decoded raster and the import bounds may use. `stored` is the
// encoded frame, kept to recognise an engine that ignored the Orientation.
type HeaderImageInfo = {
  readonly stored: ImageDimensions;
  readonly oriented: ImageDimensions;
  readonly orientation: ExifOrientation;
};

export async function loadImageAsRawData(
  file: File,
  maxEdge: number = MAX_EDGE_PX,
  signal?: AbortSignal,
): Promise<RawImageData> {
  checkTraceSignal(signal);
  if (isGif(file)) file = await awaitTraceSignal(freezeGif(file), signal);
  checkTraceSignal(signal);
  const header = await awaitTraceSignal(readHeaderImageInfo(file, signal), signal);
  checkTraceSignal(signal);
  if (header !== null) {
    assertSafeDecodeDimensions(header.oriented);
    const target = scaleToCap(header.oriented.width, header.oriented.height, maxEdge);
    const resizedBitmap = await decodeResizedImageBitmap(file, header.oriented, target, signal);
    if (resizedBitmap !== null) {
      try {
        checkTraceSignal(signal);
        return rasterizeImage(resizedBitmap, target.width, target.height);
      } finally {
        resizedBitmap.close();
      }
    }
  }
  // The try/finally pairing around createObjectURL + revokeObjectURL is
  // load-bearing: each createObjectURL allocation pins the underlying
  // Blob in memory until revokeObjectURL is called or the document is
  // torn down. A future refactor that swaps the try/finally for a bare
  // try/catch (or moves the decode out of the same function) would leak
  // the Blob on every import. Keep them in lockstep. R-L3 audit note.
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url, signal);
    checkTraceSignal(signal);
    return rasterizeDecodedElement(img, header, maxEdge);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Put a stored raster's decoded source back on the pixel grid the project
 * saved for it. A JPEG with an axis-swapping EXIF Orientation imported before
 * ADR-396 was saved on its stored (landscape) grid, filled with the photo
 * squashed into it; its luminance, bounds and editor contract all use that
 * grid. The loader now decodes it turned, so a decode that comes back as that
 * grid transposed is resampled onto it, reproducing the pixels the project
 * holds. Any other decode is returned unchanged.
 */
export function fitDecodeToStoredGrid(
  pixels: RawImageData,
  width: number,
  height: number,
): RawImageData {
  if (width === height || pixels.width !== height || pixels.height !== width) return pixels;
  const resampled = resampleBuffer(pixels, width, height);
  return pixels.rgbCompositedOnWhite === true
    ? { ...resampled, rgbCompositedOnWhite: true }
    : resampled;
}

async function decodeResizedImageBitmap(
  file: File,
  source: ImageDimensions,
  target: ImageDimensions,
  signal?: AbortSignal,
): Promise<ImageBitmap | null> {
  const needsResize = source.width !== target.width || source.height !== target.height;
  if (!needsResize || typeof createImageBitmap !== 'function') return null;
  try {
    // The resize size is the ORIENTED size, so the orientation must be the
    // image's own. Explicit rather than trusting a default the specification
    // has changed: without it a turned phone photo came back squashed.
    const decoded = createImageBitmap(file, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
      imageOrientation: 'from-image',
    });
    void decoded.then(
      (bitmap) => {
        if (signal?.aborted === true) bitmap.close();
      },
      () => undefined,
    );
    const bitmap = await awaitTraceSignal(decoded, signal);
    // A conforming engine returns exactly the requested size. One that
    // ignored the resize options returns its full decoded frame: keep it when
    // it has the oriented aspect (the caller scales it to the target), but a
    // frame with the stored, swapped aspect means the engine ignored the
    // Orientation too, and stretching it onto the target would squash the
    // photo. The element route turns such an image itself.
    if (hasOrientedAspect(bitmap, source)) return bitmap;
    bitmap.close();
    return null;
  } catch (error) {
    if (isTraceAbort(error)) throw error;
    // Safari/WebView variants may expose createImageBitmap without supporting
    // resize options. The object-URL HTMLImageElement path remains compatible.
    return null;
  }
}

// Which of the two readings of the header, turned or stored, the decoded
// frame's aspect ratio is closer to. A square frame cannot tell them apart
// and is kept.
function hasOrientedAspect(frame: ImageDimensions, oriented: ImageDimensions): boolean {
  const turnedError = Math.abs(frame.width * oriented.height - frame.height * oriented.width);
  const storedError = Math.abs(frame.width * oriented.width - frame.height * oriented.height);
  return turnedError <= storedError;
}

// The HTMLImageElement route. Engines that implement CSS image-orientation
// (Chromium 81+, Firefox 77+, Safari 13.1+) report and draw the element
// already turned. One that reports the STORED frame of a turned JPEG has
// ignored the Orientation, so the turn is drawn here instead: either way the
// raster has the oriented aspect ratio the header, and so the import bounds,
// promised.
function rasterizeDecodedElement(
  img: HTMLImageElement,
  header: HeaderImageInfo | null,
  maxEdge: number,
): RawImageData {
  const natural = { width: img.width, height: img.height };
  const orientation =
    header !== null && engineIgnoredOrientation(natural, header) ? header.orientation : 1;
  const oriented = orientedDimensions(natural, orientation);
  const { width, height } = scaleToCap(oriented.width, oriented.height, maxEdge);
  return rasterizeImage(img, width, height, orientation);
}

function engineIgnoredOrientation(natural: ImageDimensions, header: HeaderImageInfo): boolean {
  if (!orientationSwapsAxes(header.orientation)) return false;
  const { stored } = header;
  return (
    stored.width !== stored.height &&
    natural.width === stored.width &&
    natural.height === stored.height
  );
}

function rasterizeImage(
  source: CanvasImageSource,
  width: number,
  height: number,
  orientation: ExifOrientation = 1,
): RawImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new Error('Could not create 2D canvas context for image decoding.');
  }
  if (orientation === 1) {
    ctx.drawImage(source, 0, 0, width, height);
  } else {
    ctx.setTransform(...orientationCanvasTransform(orientation, width, height));
    const swap = orientationSwapsAxes(orientation);
    ctx.drawImage(source, 0, 0, swap ? height : width, swap ? width : height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  const imgd = ctx.getImageData(0, 0, width, height);
  return compositeRgbOverWhitePreservingAlpha({
    width: imgd.width,
    height: imgd.height,
    data: imgd.data,
  });
}

export function compositeRgbOverWhitePreservingAlpha(image: RawImageData): RawImageData {
  if (image.rgbCompositedOnWhite === true) return image;
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < image.data.length; i += 4) {
    const alpha = image.data[i + 3] ?? 255;
    const opacity = alpha / 255;
    data[i] = compositeChannel(image.data[i], opacity);
    data[i + 1] = compositeChannel(image.data[i + 1], opacity);
    data[i + 2] = compositeChannel(image.data[i + 2], opacity);
    data[i + 3] = alpha;
  }
  return { width: image.width, height: image.height, data, rgbCompositedOnWhite: true };
}

function compositeChannel(value: number | undefined, opacity: number): number {
  const source = value ?? 0;
  return Math.round(source * opacity + PAPER_WHITE * (1 - opacity));
}

export async function readImageNaturalSize(
  file: File,
): Promise<{ readonly width: number; readonly height: number }> {
  if (isGif(file)) file = await freezeGif(file);
  const header = await readHeaderImageInfo(file);
  if (header !== null) {
    assertSafeDecodeDimensions(header.oriented);
    return header.oriented;
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await decodeImage(url);
    return { width: img.width, height: img.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function decodeImage(url: string, signal?: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort);
      img.onload = null;
      img.onerror = null;
    };
    const abort = (): void => {
      cleanup();
      img.src = '';
      reject(traceAbortError());
    };
    if (signal?.aborted === true) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    img.onload = (): void => {
      cleanup();
      resolve(img);
    };
    img.onerror = (): void => {
      cleanup();
      reject(new Error('Failed to decode image — unsupported format?'));
    };
    img.src = url;
  });
}

async function readHeaderImageInfo(
  file: File,
  signal?: AbortSignal,
): Promise<HeaderImageInfo | null> {
  const header = await readImageHeader(file, signal);
  const png = parsePngDimensions(header);
  if (png !== null) return { stored: png, oriented: png, orientation: 1 };
  const jpeg = parseJpegHeader(header);
  if (jpeg === null) return null;
  return {
    stored: jpeg.stored,
    oriented: orientedDimensions(jpeg.stored, jpeg.orientation),
    orientation: jpeg.orientation,
  };
}

/** Read only a PNG IHDR size, without invoking a browser image decoder. */
export async function readPngHeaderDimensions(file: File): Promise<ImageDimensions | null> {
  return parsePngDimensions(await readImageHeader(file));
}

/** Whether the embedded route can allocate its full-size Chromium canvas. */
export function embeddedCanvasSupportsImageDimensions(dimensions: ImageDimensions): boolean {
  const pixels = dimensions.width * dimensions.height;
  return (
    dimensions.width <= MAX_SAFE_DECODE_EDGE_PX &&
    dimensions.height <= MAX_SAFE_DECODE_EDGE_PX &&
    pixels <= MAX_SAFE_DECODE_PIXELS
  );
}

function assertSafeDecodeDimensions(dimensions: ImageDimensions): void {
  if (!embeddedCanvasSupportsImageDimensions(dimensions)) {
    throw new Error(
      `Image source dimensions ${dimensions.width}x${dimensions.height} px are too large to decode safely. Resize the image before importing.`,
    );
  }
}

function parsePngDimensions(header: Uint8Array): ImageDimensions | null {
  if (header.byteLength < 24 || !hasPngSignature(header)) return null;
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  const ihdrLength = view.getUint32(8);
  const ihdrType =
    String.fromCharCode(header[12] ?? 0) +
    String.fromCharCode(header[13] ?? 0) +
    String.fromCharCode(header[14] ?? 0) +
    String.fromCharCode(header[15] ?? 0);
  if (ihdrLength !== 13 || ihdrType !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function hasPngSignature(header: Uint8Array): boolean {
  return (
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  );
}

// Exported for unit testing the cap math directly (decodeImage needs a real
// browser canvas, so the cap behaviour is verified here as a pure function).
export function scaleToCap(
  width: number,
  height: number,
  cap: number,
): { readonly width: number; readonly height: number } {
  const longest = Math.max(width, height);
  if (longest <= cap) return { width, height };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

// F.2.e: extract a luma buffer (one byte per pixel, ITU-R BT.601)
// from RGBA image data, then base64-encode it for JSON transit.
// Used by the Add Image flow so compile-job can dither pure-core
// from RasterImage.lumaBase64 without touching the DOM.
export function extractLumaBase64(image: RawImageData): string {
  const pixelCount = image.width * image.height;
  const buf = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const r = image.data[i * 4] ?? 0;
    const g = image.data[i * 4 + 1] ?? 0;
    const b = image.data[i * 4 + 2] ?? 0;
    buf[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  // btoa wants a "binary string" (each char's code point = byte). One char
  // per byte rather than String.fromCharCode(...buf) because the spread
  // form hits V8's argument-count limit at ~64K pixels (LU10: an earlier
  // comment claimed chunking that never existed — this loop is O(n) appends,
  // not chunked, and that is fine).
  let bin = '';
  for (const v of buf) {
    bin += String.fromCharCode(v);
  }
  return btoa(bin);
}

// Read a File's bytes as a base64 data URL ('data:image/png;base64,…').
// Distinct from loadImageAsRawData: this preserves the ORIGINAL bytes —
// no decode, no downscale — so the stored bitmap is full quality. Used by
// the Import Image flow (Toolbar) to embed the source image in the .lf2
// project (ADR-020); that same stored dataUrl is what the Trace tool later
// reconstructs (dataUrlToFile, below) to overlay a vector trace on the
// already-imported bitmap (ADR-026, unified image flow).
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      // Fail at the read boundary instead of resolving '' — an empty data URL
      // would be stored as the project's image and silently engrave nothing
      // (P2-A). A non-string result here means the read did not produce a data
      // URL, which is an error, not an empty image.
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader returned a non-string result for the image.'));
      }
    };
    reader.onerror = (): void => reject(new Error('FileReader failed to read the image.'));
    reader.readAsDataURL(file);
  });
}

// Reconstruct a File from a stored data URL. The unified image flow
// (LightBurn model) imports a bitmap first, then runs Trace as a tool on
// that already-imported RasterImage — but the trace preview + commit
// pipeline (useTracePreview, loadImageAsRawData) is keyed on a File. Round-
// tripping the RasterImage's embedded dataUrl back into a File lets the
// trace tool reuse that pipeline unchanged instead of forking it to accept
// raw pixels. Do not use fetch(dataUrl) here: production CSP's connect-src
// intentionally blocks data: fetches, while Vite dev has no matching
// Cloudflare header.
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File> {
  const { mimeType, bytes } = decodeDataUrl(dataUrl);
  return new File([toArrayBuffer(bytes)], filename, { type: mimeType });
}

function decodeDataUrl(dataUrl: string): {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
} {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('Stored image is not a data URL.');
  }
  const comma = dataUrl.indexOf(',');
  if (comma < 0) {
    throw new Error('Stored image data URL is malformed.');
  }

  const header = dataUrl.slice('data:'.length, comma);
  const payload = dataUrl.slice(comma + 1);
  const parts = header.split(';').filter(Boolean);
  const mimeType = parts.find((part) => part.toLowerCase() !== 'base64') ?? '';
  const isBase64 = parts.some((part) => part.toLowerCase() === 'base64');

  if (!isBase64) {
    return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  }

  const bin = atob(decodeURIComponent(payload.replace(/\s/g, '')));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i);
  }
  return { mimeType, bytes };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
