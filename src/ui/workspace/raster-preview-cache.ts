// Storage for rendered raster-preview canvases (F.2.c, ADR-028).
//
// Two things decide the shape of this cache.
//
// 1. Every move commits `{ ...object, transform }` — a brand-new RasterImage
//    holding the same pixels — so a cache keyed on object identity misses on
//    every nudge, drag, align and flip. Records are therefore keyed on the
//    scene-object id, which survives that clone, and validated against the
//    raster's content, which an Image Studio Apply replaces while keeping the
//    id. Content is compared by `===` on the payload fields: a transform-only
//    clone copies the string REFERENCE, so the comparison is a pointer check
//    that never touches the base64 bytes. Concatenating those bytes into a key
//    cost a multi-megabyte string per raster per frame, which is the cost the
//    identity keying was introduced to remove.
// 2. A canvas is up to 2048x2048 RGBA (~16.8 MB) and superseded Project
//    versions stay reachable through the undo stack, so canvases must be
//    released by an explicit sweep rather than left to GC.

import type { RasterImage } from '../../core/scene';

/** Distinguishes "nothing cached" from a cached decision not to draw. */
export type CachedPreviewCanvas =
  | { readonly kind: 'hit'; readonly canvas: HTMLCanvasElement | null }
  | { readonly kind: 'miss' };

/** The raster fields that change the rendered pixels, all cheap to compare. */
export type RasterContentToken = {
  readonly dataUrl: string | undefined;
  readonly lumaBase64: string | undefined;
  readonly lumaAssetId: string | undefined;
  readonly lumaByteLength: number | undefined;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
};

type PreviewCacheRecord = {
  readonly content: RasterContentToken;
  readonly canvases: Map<string, HTMLCanvasElement | null>;
};

const recordsById = new Map<string, PreviewCacheRecord>();

// Identity fast path: while a raster is untouched, its record is found without
// reading the payload fields at all.
const recordsByObject = new WeakMap<RasterImage, PreviewCacheRecord>();

export function rasterContentToken(obj: RasterImage): RasterContentToken {
  return {
    dataUrl: obj.dataUrl,
    lumaBase64: obj.lumaBase64,
    lumaAssetId: obj.imageAsset?.lumaAssetId,
    lumaByteLength: obj.imageAsset?.lumaByteLength,
    pixelWidth: obj.pixelWidth,
    pixelHeight: obj.pixelHeight,
  };
}

export function sameRasterContent(content: RasterContentToken, obj: RasterImage): boolean {
  return (
    content.dataUrl === obj.dataUrl &&
    content.lumaBase64 === obj.lumaBase64 &&
    content.lumaAssetId === obj.imageAsset?.lumaAssetId &&
    content.lumaByteLength === obj.imageAsset?.lumaByteLength &&
    content.pixelWidth === obj.pixelWidth &&
    content.pixelHeight === obj.pixelHeight
  );
}

export function lookupPreviewCanvas(obj: RasterImage, settingsKey: string): CachedPreviewCanvas {
  const record = recordFor(obj);
  if (record === undefined || !record.canvases.has(settingsKey)) return { kind: 'miss' };
  return { kind: 'hit', canvas: record.canvases.get(settingsKey) ?? null };
}

export function storePreviewCanvas(
  obj: RasterImage,
  settingsKey: string,
  canvas: HTMLCanvasElement | null,
): void {
  const record = recordFor(obj) ?? registerRecord(obj);
  record.canvases.set(settingsKey, canvas);
}

/** Releases every canvas whose raster is no longer previewed. */
export function retainPreviewCanvases(liveRasterIds: ReadonlySet<string>): void {
  for (const id of recordsById.keys()) {
    if (!liveRasterIds.has(id)) recordsById.delete(id);
  }
}

function recordFor(obj: RasterImage): PreviewCacheRecord | undefined {
  const registered = recordsById.get(obj.id);
  if (registered === undefined) return undefined;
  // Reference equality against the registered record, so a record already
  // released by retainPreviewCanvases can never be resurrected through a stale
  // object the undo stack still holds.
  if (recordsByObject.get(obj) === registered) return registered;
  if (!sameRasterContent(registered.content, obj)) return undefined;
  recordsByObject.set(obj, registered);
  return registered;
}

function registerRecord(obj: RasterImage): PreviewCacheRecord {
  const record: PreviewCacheRecord = { content: rasterContentToken(obj), canvases: new Map() };
  recordsById.set(obj.id, record);
  recordsByObject.set(obj, record);
  return record;
}
