const BINARY_CHUNK_BYTES = 48 * 1024;

type NativeBase64Bytes = Uint8Array & { toBase64?: () => string };

/** Worker-safe base64 encoding without constructing one source-sized binary string. */
export function bytesToBase64(bytes: Uint8Array): string {
  // Chromium 140+ encodes natively; the chunked form below gives the same text
  // (each 48 KiB chunk is a multiple of 3 bytes, so no padding falls inside).
  const native = (bytes as NativeBase64Bytes).toBase64;
  if (typeof native === 'function') return native.call(bytes);
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BINARY_CHUNK_BYTES);
    // apply accepts a typed array as its argument list, without an Array copy.
    const binary = String.fromCharCode.apply(null, chunk as unknown as number[]);
    encoded.push(btoa(binary));
  }
  return encoded.join('');
}
