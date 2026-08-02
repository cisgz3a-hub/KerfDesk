import type { RasterImage } from '../../core/scene';
import { BURN_MAX_EDGE_PX, BURN_MAX_SOURCE_PIXELS } from '../trace/image-loader';
import { IndexedDbPagedAssetRepository } from './paged-asset-indexeddb';
import { importPngOffThread, type PngImportWorkerProgress } from './png-import-worker-client';

export type QualifiedPngRaster = {
  readonly natural: { readonly width: number; readonly height: number };
  readonly sampled: { readonly width: number; readonly height: number };
  readonly densityDpi: number | null;
  readonly imageAsset: NonNullable<RasterImage['imageAsset']>;
  readonly rollback: () => Promise<string | null>;
};

export type QualifiedPngDecodeOptions = {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PngImportWorkerProgress) => void;
};

// Page-backing point (ADR-283).
//
// A page-backed raster stores its bytes in origin-scoped IndexedDB and puts only
// asset ids in the `.lf2`, so such a file is NOT self-contained: it does not open
// on another machine, browser profile, or after storage eviction. An embedded
// raster carries its own bytes and stays portable, at the cost of holding the
// whole image in memory on import and save.
//
// Below this size the portable representation wins outright — the memory cost is
// not worth losing a file the operator can email. Above it, embedding is what
// exhausts renderer memory, which is the problem the paged path exists to solve.
//
// The value deliberately coincides with LARGE_IMPORT_ADVISORY_BYTES: page-backing
// starts exactly where the operator is already told the import will be slow, so
// the format change never happens silently. The two are separate constants
// because this one is a persistence-schema boundary governed by ADR-283, while
// the advisory is a UX judgement that may move on its own.
export const PAGED_PNG_MIN_BYTES = 25 * 1024 * 1024;

/** True when a PNG is large enough that its bytes belong in paged storage. */
export function shouldPageBackPng(file: File): boolean {
  return isPngCandidate(file) && file.size > PAGED_PNG_MIN_BYTES;
}

export async function tryDecodeQualifiedPng(
  file: File,
  options: QualifiedPngDecodeOptions = {},
): Promise<QualifiedPngRaster | null> {
  if (!shouldPageBackPng(file)) return null;
  const assetId = crypto.randomUUID();
  const lumaAssetId = crypto.randomUUID();
  const pending = importPngOffThread(file, {
    assetId,
    lumaAssetId,
    sourceName: file.name,
    createdAtEpochMs: Date.now(),
    maxEdge: BURN_MAX_EDGE_PX,
    maxPixels: BURN_MAX_SOURCE_PIXELS,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  });
  if (pending === null) return null;
  const repository = new IndexedDbPagedAssetRepository();
  try {
    const result = await pending;
    if (result.kind === 'legacy-fallback') return null;
    return {
      natural: { width: result.width, height: result.height },
      sampled: { width: result.sampledWidth, height: result.sampledHeight },
      densityDpi: result.densityDpi,
      imageAsset: {
        schemaVersion: 1,
        repository: 'curvedesk-import-assets-v1',
        sourceAssetId: result.sourceManifest.assetId,
        lumaAssetId: result.lumaManifest.assetId,
        sourceMimeType: result.sourceManifest.mimeType,
        sourceByteLength: result.sourceManifest.byteLength,
        lumaByteLength: result.lumaManifest.byteLength,
        naturalWidth: result.width,
        naturalHeight: result.height,
        sampledWidth: result.sampledWidth,
        sampledHeight: result.sampledHeight,
        thumbnail: {
          mimeType: result.thumbnail.mimeType,
          dataUrl: bytesToDataUrl(result.thumbnail.bytes, result.thumbnail.mimeType),
          width: result.thumbnail.width,
          height: result.thumbnail.height,
        },
      },
      rollback: () => cleanup(repository, assetId, lumaAssetId),
    };
  } catch (error) {
    const cleanupWarning = await cleanup(repository, assetId, lumaAssetId);
    if (isAbortError(error)) throw error;
    if (cleanupWarning === null) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new AggregateError([error], `${message}. ${cleanupWarning}`);
  }
}

async function cleanup(
  repository: IndexedDbPagedAssetRepository,
  assetId: string,
  lumaAssetId: string,
): Promise<string | null> {
  const failed: string[] = [];
  for (const id of [assetId, lumaAssetId]) {
    try {
      await repository.abort(id);
    } catch {
      failed.push(id);
    }
  }
  return failed.length === 0
    ? null
    : 'Temporary PNG import pages could not be removed and will be cleaned later.';
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  const pieces: string[] = [];
  const chunkBytes = 0x6000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkBytes) {
    pieces.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkBytes)));
  }
  return `data:${mimeType};base64,${btoa(pieces.join(''))}`;
}

export function isPngCandidate(file: File): boolean {
  return file.type.toLowerCase() === 'image/png' || /\.png$/i.test(file.name);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
