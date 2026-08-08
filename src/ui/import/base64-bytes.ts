const BINARY_CHUNK_BYTES = 48 * 1024;

/** Worker-safe base64 encoding without constructing one source-sized binary string. */
export function bytesToBase64(bytes: Uint8Array): string {
  const encoded: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += BINARY_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, offset + BINARY_CHUNK_BYTES);
    const binary = String.fromCharCode.apply(null, chunk as unknown as number[]);
    encoded.push(btoa(binary));
  }
  return encoded.join('');
}
