import type { CrackSubPixelField } from './contour-boundary';
import { coherentThinMask } from './coherent-thin-mask';
import type { RawImageData } from './trace-image';

/** Add coherent local-contrast strokes to the actual preset threshold result. */
export function prepareFaintLineMask(
  base: RawImageData,
  baseField: CrackSubPixelField | null,
  localField: CrackSubPixelField,
  pixelScale: number,
): { readonly prepared: RawImageData; readonly crackField: CrackSubPixelField | null } {
  const { width, height } = base;
  // Coherence belongs to the complete stroke, including dark runs already in
  // the preset mask. Keeping full solid areas in this test also prevents their
  // local-contrast edge from qualifying as a separate narrow stroke.
  const coherent = coherentThinMask(completeInk(base, localField), width, height, pixelScale);
  // Only newly admitted local ink changes the mask or its interpolation field.
  for (let index = 0; index < coherent.length; index += 1) {
    if ((base.data[index * 4] ?? 255) < 128) coherent[index] = 0;
  }
  if (!coherent.includes(1)) return { prepared: base, crackField: baseField };
  const data = base.data.slice();
  for (let index = 0; index < coherent.length; index += 1) {
    if (coherent[index] === 1) data.set([0, 0, 0, 255], index * 4);
  }
  const prepared = { width, height, data };
  return {
    prepared,
    crackField:
      baseField === null
        ? null
        : faintCrackField(prepared, baseField, localField, detailSupport(coherent, width, height)),
  };
}

function completeInk(base: RawImageData, local: CrackSubPixelField): Uint8Array {
  const { width, height } = base;
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if ((base.data[index * 4] ?? 255) < 128 || local.lumaAt(x, y) < local.thresholdAt(x, y))
        ink[index] = 1;
    }
  }
  return ink;
}

function faintCrackField(
  mask: RawImageData,
  base: CrackSubPixelField,
  local: CrackSubPixelField,
  support: Uint8Array,
): CrackSubPixelField {
  return {
    lumaAt: base.lumaAt,
    thresholdAt: (x, y) => {
      const baseThreshold = base.thresholdAt(x, y);
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return baseThreshold;
      const index = y * mask.width + x;
      if (support[index] !== 1) return baseThreshold;
      const threshold = Math.max(baseThreshold, below(local.thresholdAt(x, y)));
      // Local interpolation extends one pixel into surrounding paper so a pale
      // stroke's edge does not collapse toward its ink centre. Rejected noise
      // in that neighbourhood must still agree with the selected binary mask.
      return (mask.data[index * 4] ?? 255) < 128
        ? threshold
        : Math.min(threshold, below(local.lumaAt(x, y)));
    },
  };
}

function below(value: number): number {
  return value - Number.EPSILON * Math.max(1, Math.abs(value));
}

function detailSupport(coherent: Uint8Array, width: number, height: number): Uint8Array {
  const support = new Uint8Array(coherent.length);
  for (let index = 0; index < coherent.length; index += 1) {
    if (coherent[index] !== 1) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = Math.max(0, y - 1); dy <= Math.min(height - 1, y + 1); dy += 1)
      for (let dx = Math.max(0, x - 1); dx <= Math.min(width - 1, x + 1); dx += 1)
        support[dy * width + dx] = 1;
  }
  return support;
}
