import type { TiffPixels } from '../../io/tiff/tiff-page';
import {
  pageCanvas,
  type PagedArtworkSource,
  type PreparedArtworkPage,
} from './paged-artwork-source';

type Reply = {
  readonly id: number;
  readonly error?: string;
  readonly pageCount?: number;
  readonly pixels?: TiffPixels;
};
type Pending = {
  readonly resolve: (reply: Reply) => void;
  readonly reject: (error: Error) => void;
};

export async function openTiffArtwork(file: File): Promise<PagedArtworkSource> {
  const worker = new Worker(new URL('./tiff-import.worker.ts', import.meta.url), {
    type: 'module',
  });
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let closed = false;
  const dispose = (): Promise<void> => {
    closed = true;
    worker.terminate();
    for (const request of pending.values()) request.reject(new Error('TIFF import closed.'));
    pending.clear();
    return Promise.resolve();
  };
  worker.onmessage = (event: MessageEvent<Reply>) => {
    const request = pending.get(event.data.id);
    if (request === undefined) return;
    pending.delete(event.data.id);
    if (event.data.error !== undefined) request.reject(new Error(event.data.error));
    else request.resolve(event.data);
  };
  worker.onerror = () => {
    void dispose();
  };
  worker.onmessageerror = () => {
    void dispose();
  };
  const send = (payload: { bytes?: ArrayBuffer; page?: number }): Promise<Reply> =>
    new Promise((resolve, reject) => {
      if (closed) {
        reject(new Error('TIFF import closed. Reopen the file to try again.'));
        return;
      }
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ id, ...payload }, payload.bytes === undefined ? [] : [payload.bytes]);
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  try {
    const initial = await send({ bytes: await file.arrayBuffer() });
    if (initial.pageCount === undefined) throw new Error('Could not read TIFF pages.');
    return {
      name: file.name,
      pageCount: initial.pageCount,
      dispose,
      prepare: async (page) => {
        const reply = await send({ page });
        if (reply.pixels === undefined) throw new Error('Could not read TIFF pixels.');
        return preparePixels(reply.pixels);
      },
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}

function preparePixels(pixels: TiffPixels): PreparedArtworkPage {
  const canvas = pageCanvas(pixels.width, pixels.height);
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Could not prepare TIFF image.');
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
  const ratio = Math.min(1, 700 / Math.max(pixels.width, pixels.height));
  const preview = pageCanvas(pixels.width * ratio, pixels.height * ratio);
  preview.getContext('2d')?.drawImage(canvas, 0, 0, preview.width, preview.height);
  return {
    widthMm: pixels.widthMm,
    heightMm: pixels.heightMm,
    thumbnail: preview.toDataURL('image/png'),
    vectorSvg: null,
    resolutionEditable: false,
    note:
      'Original ' +
      pixels.width +
      ' × ' +
      pixels.height +
      ' pixel grid preserved. ' +
      (pixels.densitySource === 'embedded'
        ? 'Size uses embedded TIFF density.'
        : 'Size uses 254 DPI because usable density is absent.') +
      ' Colours are converted to 8-bit RGB for engraving.',
    render: () => Promise.resolve(canvas),
  };
}
