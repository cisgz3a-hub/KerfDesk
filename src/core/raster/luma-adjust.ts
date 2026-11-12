export type LumaAdjustments = {
  readonly brightness?: number;
  readonly contrast?: number;
  readonly gamma?: number;
};

const BYTE_MAX = 255;
const LEVELS = BYTE_MAX + 1;

export function applyLumaAdjustments(input: Uint8Array, adjustments: LumaAdjustments): Uint8Array {
  const lut = lumaAdjustmentLut(adjustments);
  if (lut === null) return input;
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = lut[input[i] ?? BYTE_MAX] ?? BYTE_MAX;
  return out;
}

/**
 * The 256-entry curve brightness, contrast and gamma compose to, or null when
 * none is off its default (ADR-671). Each stage keeps its own clamp and the
 * order brightness → contrast → gamma, but the value stays a float until one
 * final rounding. Rounding after every stage merged neighbouring grey levels
 * and banded smooth skin gradients.
 */
export function lumaAdjustmentLut(adjustments: LumaAdjustments): Uint8Array | null {
  // A hand-edited project can carry NaN or a contrast below -100, which no
  // control produces: NaN made every level 0 (a solid burn) and a negative
  // contrast factor reversed the curve. Both fall back to the nearest valid
  // setting, so the curve stays monotone (oracle audit O6-P3-3).
  const brightness = numberOr(adjustments.brightness, 0);
  const contrast = Math.max(-100, numberOr(adjustments.contrast, 0));
  const gamma = numberOr(adjustments.gamma, 1);
  if (brightness === 0 && contrast === 0 && gamma === 1) return null;
  const offset = brightness * 2.55;
  const factor = 1 + contrast / 100;
  const invG = 1 / Math.max(0.1, Math.min(5, gamma));
  const lut = new Uint8Array(LEVELS);
  for (let level = 0; level < LEVELS; level += 1) {
    let v = level;
    if (brightness !== 0) v = clampLevel(v + offset);
    if (contrast !== 0) v = clampLevel((v - 128) * factor + 128);
    if (invG !== 1) v = clampLevel(Math.pow(v / BYTE_MAX, invG) * BYTE_MAX);
    lut[level] = Math.round(v);
  }
  return lut;
}

export function maybeInvertLuma(input: Uint8Array, negative: boolean): Uint8Array {
  if (!negative) return input;
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) out[i] = BYTE_MAX - (input[i] ?? BYTE_MAX);
  return out;
}

function numberOr(value: number | undefined, fallback: number): number {
  return value === undefined || Number.isNaN(value) ? fallback : value;
}

// The stage clamp without the stage rounding: NaN (an infinite contrast factor
// times a zero difference) falls to 0 as the former byte clamp's NaN did.
function clampLevel(value: number): number {
  return value > 0 ? Math.min(BYTE_MAX, value) : 0;
}
