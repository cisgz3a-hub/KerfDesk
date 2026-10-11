import { decodeCanonicalBase64 } from '../../core/relief/depth-map-base64';

const BASE64_SLICE_CHARS = 256 * 1024;
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Native exports are canonical Base64. Decode a bounded slice per task so a
 * saved 32 MiB document cannot block input with millions of array callbacks. */
export async function decodeSnapshotBytes(value: string): Promise<Uint8Array<ArrayBuffer>> {
  await nextTask();
  if (value.length % 4 !== 0) throw new Error('The editor returned invalid artwork data.');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const result = new Uint8Array((value.length / 4) * 3 - padding);
  let target = 0;
  for (let offset = 0; offset < value.length; offset += BASE64_SLICE_CHARS) {
    const end = Math.min(offset + BASE64_SLICE_CHARS, value.length);
    const decoded = decodeCanonicalBase64(value.slice(offset, end));
    if (decoded.kind === 'error') throw new Error('The editor returned invalid artwork data.');
    const chunk = decoded.bytes;
    if (end < value.length && chunk.length !== ((end - offset) / 4) * 3)
      throw new Error('The editor returned invalid artwork data.');
    result.set(chunk, target);
    target += chunk.length;
    await nextTask();
  }
  return result;
}
