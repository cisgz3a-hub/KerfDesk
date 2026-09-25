import { DEFAULT_RASTER_LAYER_COLOR, type RasterImage, type SceneObject } from '../../core/scene';
import type { ParsedSvgFragment, SvgImageDescriptor } from '../../io/svg/svg-import-fragment';
import { loadImageSamples, type LoadedImageSamples } from './prepare-image-samples';
import { shouldDecodeDimensionQualifiedPng, shouldPageBackPng } from './qualified-png-raster';

export type PreparedSvgFragment = {
  readonly objects: readonly SceneObject[];
  readonly commit: () => void;
  readonly rollback: () => Promise<void>;
};

type ImageRollback = () => Promise<string | null>;

/** Acquire all bitmap resources before the caller atomically inserts one SVG.
 * Call commit only after insertion succeeds; otherwise await rollback. */
export async function prepareSvgFragment(
  fragment: ParsedSvgFragment,
  options: { readonly signal?: AbortSignal } = {},
): Promise<PreparedSvgFragment> {
  const objects: SceneObject[] = [];
  const rollbacks: ImageRollback[] = [];
  const ownership = fragmentOwnership(rollbacks);
  try {
    options.signal?.throwIfAborted();
    for (const entry of fragment.entries) {
      options.signal?.throwIfAborted();
      if (entry.kind !== 'svg-image') {
        objects.push(entry);
        continue;
      }
      const file = await embeddedBitmapFile(entry.dataUrl, options.signal);
      const pageBacked = shouldPageBackPng(file);
      const dimensionQualified = !pageBacked && (await shouldDecodeDimensionQualifiedPng(file));
      options.signal?.throwIfAborted();
      const loaded = await loadImageSamples(file, pageBacked, dimensionQualified, options);
      if (loaded.kind === 'paged') rollbacks.push(loaded.rollback);
      options.signal?.throwIfAborted();
      objects.push(hydratedImage(entry, loaded));
    }
    return { objects, ...ownership };
  } catch (error) {
    try {
      await ownership.rollback();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${errorMessage(error)} Temporary SVG image cleanup also failed: ${errorMessage(cleanupError)}`,
      );
    }
    throw error;
  }
}

function hydratedImage(entry: SvgImageDescriptor, loaded: LoadedImageSamples): RasterImage {
  if (loaded.kind === 'embedded' && loaded.cleanupWarning !== undefined) {
    throw new Error(loaded.cleanupWarning);
  }
  const source =
    loaded.kind === 'paged'
      ? { imageAsset: loaded.imageAsset }
      : { dataUrl: entry.dataUrl, lumaBase64: loaded.lumaBase64 };
  return {
    kind: 'raster-image',
    id: entry.id,
    source: entry.source,
    ...source,
    pixelWidth: loaded.sampled.width,
    pixelHeight: loaded.sampled.height,
    bounds: entry.bounds,
    transform: entry.transform,
    ...(entry.imageClip === undefined ? {} : { imageClip: entry.imageClip }),
    color: DEFAULT_RASTER_LAYER_COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function fragmentOwnership(
  rollbacks: ImageRollback[],
): Pick<PreparedSvgFragment, 'commit' | 'rollback'> {
  let state: 'pending' | 'committed' | 'rolled-back' = 'pending';
  let pendingRollback: Promise<void> | undefined;
  return {
    commit: () => {
      if (state === 'rolled-back') throw new Error('Cannot commit an SVG fragment after rollback.');
      state = 'committed';
      rollbacks.length = 0;
    },
    rollback: () => {
      if (state === 'committed') return Promise.resolve();
      if (pendingRollback !== undefined) return pendingRollback;
      state = 'rolled-back';
      pendingRollback = rollbackImages(rollbacks.splice(0));
      return pendingRollback;
    },
  };
}

async function rollbackImages(rollbacks: readonly ImageRollback[]): Promise<void> {
  const failures: unknown[] = [];
  for (const rollback of [...rollbacks].reverse()) {
    try {
      const warning = await rollback();
      if (warning !== null) failures.push(new Error(warning));
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, failures.map(errorMessage).join(' '));
  }
}

async function embeddedBitmapFile(dataUrl: string, signal?: AbortSignal): Promise<File> {
  const { mimeType, payloadOffset } = bitmapHeader(dataUrl);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const chunkCharacters = 32_768;
  let carry = '';
  for (let offset = payloadOffset; offset < dataUrl.length; offset += chunkCharacters) {
    signal?.throwIfAborted();
    const chunk = carry + dataUrl.slice(offset, offset + chunkCharacters).replace(/\s/g, '');
    // Keep the final quartet pending: permitted XML whitespace can extend past
    // padding, and padding is valid only at the end of the complete payload.
    const completeLength = Math.max(0, (Math.ceil(chunk.length / 4) - 1) * 4);
    if (completeLength > 0) parts.push(bitmapChunk(chunk.slice(0, completeLength), false));
    carry = chunk.slice(completeLength);
    // Yield during large source reconstruction so cancellation can run before
    // the next allocation; decoding itself retains the existing worker path.
    if ((offset - payloadOffset + chunkCharacters) % 1_048_576 === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
  signal?.throwIfAborted();
  if (carry.length === 0) throw new Error('SVG bitmap base64 data is empty.');
  parts.push(bitmapChunk(carry, true));
  return new File(parts, `embedded.${mimeType.slice('image/'.length)}`, { type: mimeType });
}

function bitmapChunk(chunk: string, finalChunk: boolean): Uint8Array<ArrayBuffer> {
  const allowedCharacters = finalChunk ? /^[A-Za-z0-9+/]*={0,2}$/ : /^[A-Za-z0-9+/]+$/;
  if (!allowedCharacters.test(chunk)) throw new Error('SVG bitmap base64 data is malformed.');
  const binary = atob(chunk);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bitmapHeader(dataUrl: string): {
  readonly mimeType: string;
  readonly payloadOffset: number;
} {
  const header = /^data:(image\/(?:png|jpeg|bmp|webp));base64,/i.exec(dataUrl);
  const mimeType = header?.[1]?.toLowerCase();
  if (header === null || mimeType === undefined || header[0].length === dataUrl.length) {
    throw new Error('SVG images must contain an embedded PNG, JPEG, BMP, or WebP bitmap.');
  }
  return { mimeType, payloadOffset: header[0].length };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
