/// <reference lib="webworker" />
import { decodeTiffPage } from '../../io/tiff/tiff-page';
import { tiffPageCount } from '../../io/tiff/tiff-structure';

let bytes: Uint8Array | null = null;
self.onmessage = (
  event: MessageEvent<{ id: number; bytes?: ArrayBuffer; page?: number }>,
): void => {
  const { id } = event.data;
  try {
    if (event.data.bytes !== undefined) {
      bytes = new Uint8Array(event.data.bytes);
      self.postMessage({ id, pageCount: tiffPageCount(bytes) });
    } else {
      if (bytes === null || event.data.page === undefined)
        throw new Error('No TIFF document is open.');
      const pixels = decodeTiffPage(bytes, event.data.page);
      self.postMessage({ id, pixels }, { transfer: [pixels.rgba.buffer] });
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
