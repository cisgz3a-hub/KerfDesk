// RGBA -> one luma byte per pixel (ITU-R BT.601), the bytes a RasterImage
// stores as lumaBase64 and the engraving compiler dithers. DOM-free so the
// photo import worker and the UI thread run the same arithmetic: any change
// here changes every compiled photo burn.

const PAPER_WHITE = 255;

/** Luma of RGBA already composited over white (alpha ignored). */
export function lumaBytesFromCompositedRgba(
  data: ArrayLike<number>,
  pixelCount: number,
): Uint8Array {
  const luma = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const r = data[i * 4] ?? 0;
    const g = data[i * 4 + 1] ?? 0;
    const b = data[i * 4 + 2] ?? 0;
    luma[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return luma;
}

/**
 * Composite straight RGBA over white, then take its luma, without the
 * intermediate RGBA copy. Byte-identical to compositeRgbOverWhitePreservingAlpha
 * followed by lumaBytesFromCompositedRgba: each channel is the same rounded
 * value, and an opaque pixel's channel is its own value (x * 1 + 255 * 0).
 */
export function lumaBytesFromRgbaOverWhite(
  data: ArrayLike<number>,
  pixelCount: number,
): Uint8Array {
  const luma = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i += 1) {
    const at = i * 4;
    const alpha = data[at + 3] ?? 255;
    let r = data[at] ?? 0;
    let g = data[at + 1] ?? 0;
    let b = data[at + 2] ?? 0;
    if (alpha !== PAPER_WHITE) {
      const opacity = alpha / 255;
      r = compositeChannel(r, opacity);
      g = compositeChannel(g, opacity);
      b = compositeChannel(b, opacity);
    }
    luma[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }
  return luma;
}

export function compositeChannel(value: number | undefined, opacity: number): number {
  const source = value ?? 0;
  return Math.round(source * opacity + PAPER_WHITE * (1 - opacity));
}
