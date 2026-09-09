import type { CrackSubPixelField } from './contour-boundary';
import type { RawImageData, TraceOptions } from './trace-image';

/** Automatic recovery adds local detail to the preset's brightness band.
 * Deliberate Sketch remains local contrast only, including shadow removal. */
export function prepareAutomaticDetailMask(
  image: RawImageData,
  localField: CrackSubPixelField,
  options: TraceOptions,
): { readonly prepared: RawImageData; readonly crackField: CrackSubPixelField | null } {
  const cutoff = options.cutoffLuma ?? 0;
  const threshold = options.thresholdLuma ?? 128;
  const lo = Math.max(0, Math.min(255, Math.min(cutoff, threshold)));
  const hi = Math.max(0, Math.min(255, Math.max(cutoff, threshold)));
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const luma = localField.lumaAt(x, y);
      const solid = luma >= lo && luma <= hi;
      const detail = luma < localField.thresholdAt(x, y);
      const value = solid || detail ? 0 : 255;
      const offset = (y * image.width + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return {
    prepared: { width: image.width, height: image.height, data },
    // A nonzero lower cutoff can produce two disjoint luma intervals.
    // As with manual bands, use measured topology and midpoint positions.
    crackField: lo === 0 ? automaticCrackField(localField, hi) : null,
  };
}

function automaticCrackField(
  localField: CrackSubPixelField,
  solidThreshold: number,
): CrackSubPixelField {
  return {
    lumaAt: localField.lumaAt,
    thresholdAt: (x: number, y: number): number => {
      const localThreshold = localField.thresholdAt(x, y);
      // Luma is integral. Only an integer local cut needs a representable
      // downward step to express Sketch's strict < as the field's <=.
      // Keep the actual local iso value otherwise; do not round the ramp.
      const strictLocalThreshold = Number.isInteger(localThreshold)
        ? localThreshold - Number.EPSILON * Math.max(1, Math.abs(localThreshold))
        : localThreshold;
      return Math.max(solidThreshold, strictLocalThreshold);
    },
  };
}
