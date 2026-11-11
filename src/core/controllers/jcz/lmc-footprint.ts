// Where an LMC program moves the beam (ADR-704): the bounds, in galvo units,
// of every jump and mark it writes. The red-light Frame traces this rectangle
// and Start runs only a program whose footprint a completed Frame traced
// (PROJECT.md non-negotiable 21, ADR-565). Flips and the X/Y swap keep an
// axis-aligned rectangle axis-aligned, so galvo-unit bounds are exact.

import type { GalvoPoint } from './galvo-field';

export type LmcFootprint = {
  readonly minGx: number;
  readonly minGy: number;
  readonly maxGx: number;
  readonly maxGy: number;
};

export function lmcFootprint(points: ReadonlyArray<GalvoPoint>): LmcFootprint | null {
  if (points.length === 0) return null;
  let minGx = Number.POSITIVE_INFINITY;
  let minGy = Number.POSITIVE_INFINITY;
  let maxGx = Number.NEGATIVE_INFINITY;
  let maxGy = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minGx = Math.min(minGx, point.gx);
    minGy = Math.min(minGy, point.gy);
    maxGx = Math.max(maxGx, point.gx);
    maxGy = Math.max(maxGy, point.gy);
  }
  return { minGx, minGy, maxGx, maxGy };
}

export function sameLmcFootprint(a: LmcFootprint | null, b: LmcFootprint | null): boolean {
  return (
    a !== null &&
    b !== null &&
    a.minGx === b.minGx &&
    a.minGy === b.minGy &&
    a.maxGx === b.maxGx &&
    a.maxGy === b.maxGy
  );
}

/** The footprint's corners, traced in order and closed. */
export function lmcFootprintCorners(footprint: LmcFootprint): ReadonlyArray<GalvoPoint> {
  const { minGx, minGy, maxGx, maxGy } = footprint;
  return [
    { gx: minGx, gy: minGy },
    { gx: maxGx, gy: minGy },
    { gx: maxGx, gy: maxGy },
    { gx: minGx, gy: maxGy },
    { gx: minGx, gy: minGy },
  ];
}
