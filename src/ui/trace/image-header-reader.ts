import { traceAbortError } from './trace-cancellation';

const IMAGE_HEADER_PROBE_BYTES = 64 * 1024;

export async function readImageHeader(file: File, signal?: AbortSignal): Promise<Uint8Array> {
  return new Uint8Array(
    await readBlobAsArrayBuffer(file.slice(0, IMAGE_HEADER_PROBE_BYTES), signal),
  );
}

function readBlobAsArrayBuffer(blob: Blob, signal?: AbortSignal): Promise<ArrayBuffer> {
  const readWithArrayBuffer = (blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> })
    .arrayBuffer;
  if (typeof readWithArrayBuffer === 'function') return readWithArrayBuffer.call(blob);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = (): void => {
      signal?.removeEventListener('abort', abort);
      reader.onload = null;
      reader.onerror = null;
    };
    const abort = (): void => {
      cleanup();
      reader.abort();
      reject(traceAbortError());
    };
    if (signal?.aborted === true) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    reader.onload = (): void => {
      cleanup();
      if (reader.result instanceof ArrayBuffer) resolve(reader.result);
      else reject(new Error('FileReader returned a non-buffer result for the image header.'));
    };
    reader.onerror = (): void => {
      cleanup();
      reject(new Error('FileReader failed to read the image header.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}
