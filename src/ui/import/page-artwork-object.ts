import type { SceneObject } from '../../core/scene';
import { parseSvg } from '../../io/svg';
import { importImageFile } from '../commands/import-image-action';
import { parseSvgOffThread } from './document-import-worker-client';
import type { PreparedArtworkPage } from './paged-artwork-source';

type PageImportOptions = {
  readonly signal: AbortSignal;
  readonly commit: (object: SceneObject) => void;
};

export async function pageArtworkObject(
  page: PreparedArtworkPage,
  source: string,
  mode: 'paths' | 'image',
  dpi: number,
  options: PageImportOptions,
): Promise<void> {
  options.signal.throwIfAborted();
  if (mode === 'paths') {
    if (page.vectorSvg === null) throw new Error('This page must be imported as an image.');
    const id = crypto.randomUUID();
    const pending = parseSvgOffThread(
      new Blob([page.vectorSvg], { type: 'image/svg+xml' }),
      id,
      source,
      { signal: options.signal },
    );
    // Only unavailable worker infrastructure may use the established fallback.
    // A started worker failure/cancellation must never retry on the UI thread.
    const parsed =
      pending === null ? parseSvg({ svgText: page.vectorSvg, id, source }) : await pending;
    options.signal.throwIfAborted();
    if (parsed.fragment?.entries.some((entry) => entry.kind === 'svg-image'))
      throw new Error(
        'This page contains embedded images. Choose Image to retain the complete page.',
      );
    if (parsed.object === null) throw new Error('No editable paths were found on this page.');
    options.commit(parsed.object);
    return;
  }
  if (!Number.isFinite(dpi) || dpi <= 0) throw new Error('Enter a positive image resolution.');
  const canvas = await page.render(dpi);
  const file = await canvasFile(canvas, source, options.signal);
  let failure = 'Could not import this document page.';
  const imported = await importImageFile(
    file,
    (object) => {
      options.signal.throwIfAborted();
      if (object.kind !== 'raster-image') throw new Error('Could not create a page image.');
      // Commit inside the raster callback, before the importer releases its
      // rollback ownership of temporary pages. Stale documents must throw here.
      options.commit({
        ...object,
        source,
        bounds: { minX: 0, minY: 0, maxX: page.widthMm, maxY: page.heightMm },
      });
    },
    (message, variant) => {
      if (variant === 'error') failure = message;
    },
    { signal: options.signal },
  );
  if (imported === null) {
    options.signal.throwIfAborted();
    throw new Error(failure);
  }
}

function canvasFile(canvas: HTMLCanvasElement, source: string, signal: AbortSignal): Promise<File> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = (): void => reject(abortError(signal));
    signal.addEventListener('abort', abort, { once: true });
    try {
      canvas.toBlob((blob) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) reject(abortError(signal));
        else if (blob === null) reject(new Error('Could not encode this document page.'));
        else resolve(new File([blob], source + '.png', { type: 'image/png' }));
      }, 'image/png');
    } catch (error) {
      signal.removeEventListener('abort', abort);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error
    ? reason
    : new DOMException('Document page import cancelled.', 'AbortError');
}
