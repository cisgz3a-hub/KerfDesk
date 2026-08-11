import type { ReliefMeshIntrinsicBounds } from '../scene/relief';
import { meshBounds } from './triangle-mesh';

/** Derives the exact persisted bounds authority seen after legacy coordinates become Float32. */
export function legacyMeshIntrinsicBounds(positions: ArrayLike<number>): ReliefMeshIntrinsicBounds {
  const bounds = meshBounds({ positions });
  if (bounds === null || !allFinite(bounds)) return { kind: 'non-finite-float32-v1' };
  return {
    kind: 'finite-float32-v1',
    minX: canonicalZero(bounds.minX),
    minY: canonicalZero(bounds.minY),
    minZ: canonicalZero(bounds.minZ),
    maxX: canonicalZero(bounds.maxX),
    maxY: canonicalZero(bounds.maxY),
    maxZ: canonicalZero(bounds.maxZ),
  };
}

function allFinite(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
}): boolean {
  return (
    Number.isFinite(bounds.minX) &&
    Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.minZ) &&
    Number.isFinite(bounds.maxX) &&
    Number.isFinite(bounds.maxY) &&
    Number.isFinite(bounds.maxZ)
  );
}

function canonicalZero(value: number): number {
  return value === 0 ? 0 : value;
}
