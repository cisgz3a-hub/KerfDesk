import { decodeCanonicalBase64, encodeCanonicalBase64 } from '../../core/relief/depth-map-base64';

// Triplet/quartet aligned slices keep CPU work bounded. Yielding a task turn
// (not a microtask) lets Loading/Applying paint and input be handled.
const BYTE_SLICE = 192 * 1024;
const TEXT_SLICE = (BYTE_SLICE / 3) * 4;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function encodePhotoPixels(bytes: Uint8Array): Promise<string> {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BYTE_SLICE) {
    await nextTask();
    chunks.push(encodeCanonicalBase64(bytes.subarray(offset, offset + BYTE_SLICE)));
  }
  return chunks.join('');
}

export async function decodePhotoPixels(value: string, byteLength: number): Promise<Uint8Array> {
  await nextTask();
  const bytes = new Uint8Array(byteLength);
  for (let offset = 0; offset < value.length; offset += TEXT_SLICE) {
    if (offset > 0) await nextTask();
    const decoded = decodeCanonicalBase64(value.slice(offset, offset + TEXT_SLICE));
    const expected = Math.min(BYTE_SLICE, byteLength - (offset / 4) * 3);
    if (decoded.kind !== 'ok' || decoded.bytes.length !== expected)
      throw new Error('The saved photo layer pixels are invalid.');
    bytes.set(decoded.bytes, (offset / 4) * 3);
  }
  return bytes;
}
