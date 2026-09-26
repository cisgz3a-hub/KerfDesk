import type { CrackSubPixelField } from './contour-boundary';
import { lightSolidIso } from './light-solid-fill';
import type { RawImageData, TraceOptions } from './trace-image';

/** Automatic recovery adds local detail to the preset's brightness band, and
 * fills light solids that the local test alone would hollow (ADR-401).
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
  const { width, height } = image;
  const plane = classifyDetail(localField, width, height, lo, hi);
  const scale = options.pixelScale ?? 1;
  const solidIso = lightSolidIso(
    {
      width,
      height,
      luma: plane.luma,
      rgba: image.data,
      pixelScale: Number.isFinite(scale) && scale >= 1 ? scale : 1,
    },
    hi,
  );
  const data = new Uint8ClampedArray(image.data.length);
  for (let i = 0; i < plane.ink.length; i += 1) {
    const filled =
      plane.ink[i] === 1 ||
      (solidIso !== null && (plane.luma[i] as number) <= (solidIso[i] as number));
    const value = filled ? 0 : 255;
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  return {
    prepared: { width, height, data },
    // A nonzero lower cutoff can produce two disjoint luma intervals.
    // As with manual bands, use measured topology and midpoint positions.
    crackField: lo === 0 ? automaticCrackField(localField, hi, solidIso, width, height) : null,
  };
}

/** Brightness band ∪ local contrast, with the luma plane it was read from. */
function classifyDetail(
  localField: CrackSubPixelField,
  width: number,
  height: number,
  lo: number,
  hi: number,
): { width: number; height: number; luma: Float32Array; ink: Uint8Array } {
  const luma = new Float32Array(width * height);
  const ink = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const l = localField.lumaAt(x, y);
      luma[i] = l;
      const solid = l >= lo && l <= hi;
      const detail = l < localField.thresholdAt(x, y);
      ink[i] = solid || detail ? 1 : 0;
    }
  }
  return { width, height, luma, ink };
}

function automaticCrackField(
  localField: CrackSubPixelField,
  solidThreshold: number,
  solidIso: Float32Array | null,
  width: number,
  height: number,
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
      const base = Math.max(solidThreshold, strictLocalThreshold);
      if (solidIso === null) return base;
      // Filled light solids carry their own tone/paper midpoint iso; the
      // walker clamps its queries to the grid the same way the local field does.
      const cx = Math.min(width - 1, Math.max(0, x));
      const cy = Math.min(height - 1, Math.max(0, y));
      return Math.max(base, solidIso[cy * width + cx] as number);
    },
  };
}
