// Levels adjustment LUT (ADR-242, parity plan PP-E): input black/white
// points, gamma, and output range — the classic five-slider histogram tool.

import { LUT_SIZE, MAX_BYTE } from './lut';

export type LevelsParams = {
  /** Input black point 0..255; values at or below map to the output floor. */
  readonly inBlack: number;
  /** Input white point 0..255; values at or above map to the output ceiling. */
  readonly inWhite: number;
  /** Midtone gamma, 1 = linear; >1 lightens mids, <1 darkens (Photoshop). */
  readonly gamma: number;
  readonly outBlack: number;
  readonly outWhite: number;
};

export const IDENTITY_LEVELS: LevelsParams = {
  inBlack: 0,
  inWhite: MAX_BYTE,
  gamma: 1,
  outBlack: 0,
  outWhite: MAX_BYTE,
};

const MIN_GAMMA = 0.1;
const MAX_GAMMA = 10;

export function levelsLut(params: LevelsParams): Uint8Array {
  // A collapsed input range degenerates to a hard threshold at the black point.
  const inSpan = Math.max(1, params.inWhite - params.inBlack);
  const gamma = Math.max(MIN_GAMMA, Math.min(MAX_GAMMA, params.gamma));
  const lut = new Uint8Array(LUT_SIZE);
  for (let i = 0; i < LUT_SIZE; i += 1) {
    const t = Math.max(0, Math.min(1, (i - params.inBlack) / inSpan));
    const shaped = Math.pow(t, 1 / gamma);
    const out = params.outBlack + shaped * (params.outWhite - params.outBlack);
    lut[i] = Math.max(0, Math.min(MAX_BYTE, Math.round(out)));
  }
  return lut;
}
