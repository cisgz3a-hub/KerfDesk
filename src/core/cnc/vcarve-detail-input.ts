import type { Vec2 } from '../scene';
import type { BoundarySegment } from './vcarve-detail-geometry';

export type DetailDepthLaw = {
  readonly tanHalf: number;
  readonly maxDepthMm: number;
};

export function validDepthInputs(
  path: ReadonlyArray<Vec2>,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
): boolean {
  return (
    path.length >= 2 &&
    segments.length > 0 &&
    law.tanHalf > 0 &&
    Number.isFinite(law.tanHalf) &&
    law.maxDepthMm > 0 &&
    Number.isFinite(law.maxDepthMm)
  );
}

export function validDepthTolerance(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
