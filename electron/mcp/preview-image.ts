/** Decode only the fixed PNG header; the caller separately limits all encoded bytes. */
export function previewImageMatchesDimensions(image: {
  readonly data: string;
  readonly widthPx: number;
  readonly heightPx: number;
}): boolean {
  try {
    const header = atob(image.data.slice(0, 44));
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      header.length !== 33 ||
      signature.some((byte, index) => header.charCodeAt(index) !== byte) ||
      uint32(header, 8) !== 13 ||
      header.slice(12, 16) !== 'IHDR'
    )
      return false;
    return uint32(header, 16) === image.widthPx && uint32(header, 20) === image.heightPx;
  } catch {
    return false;
  }
}

function uint32(header: string, start: number): number {
  return (
    header.charCodeAt(start) * 0x1000000 +
    header.charCodeAt(start + 1) * 0x10000 +
    header.charCodeAt(start + 2) * 0x100 +
    header.charCodeAt(start + 3)
  );
}
