const MAX_BYTE = 255;
const COLOR_CHANNELS = 3;

/** Straight-alpha RGBA source pixel with alpha normalized to 0..1. */
export type SourceOverPixel = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly alpha: number;
};

/**
 * Composite one straight-alpha RGBA source pixel into an RGBA8 destination.
 * Transparent source pixels are no-ops; destination alpha participates in
 * source-over instead of being forced opaque.
 */
export function sourceOverPixelInPlace(
  destination: Uint8ClampedArray,
  base: number,
  source: SourceOverPixel,
): void {
  const sourceAlpha = Math.min(1, Math.max(0, source.alpha));
  if (sourceAlpha === 0) return;
  const destinationAlpha = (destination[base + COLOR_CHANNELS] ?? 0) / MAX_BYTE;
  const inverseSourceAlpha = 1 - sourceAlpha;
  const outputAlpha = sourceAlpha + destinationAlpha * inverseSourceAlpha;
  const sourceChannels = [source.r, source.g, source.b];
  for (let channel = 0; channel < COLOR_CHANNELS; channel += 1) {
    const sourcePremultiplied = (sourceChannels[channel] ?? 0) * sourceAlpha;
    const destinationPremultiplied =
      (destination[base + channel] ?? 0) * destinationAlpha * inverseSourceAlpha;
    destination[base + channel] = Math.round(
      (sourcePremultiplied + destinationPremultiplied) / outputAlpha,
    );
  }
  destination[base + COLOR_CHANNELS] = Math.round(outputAlpha * MAX_BYTE);
}
