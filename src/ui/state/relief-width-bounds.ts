import type { Bounds, ReliefObject } from '../../core/scene';

/** Resolves natural bounds after Width changes from each relief representation's authority. */
export function reliefWidthBounds(current: ReliefObject, updated: ReliefObject): Bounds {
  if (updated.reliefSource.kind === 'heightfield-v1') {
    return {
      minX: 0,
      minY: 0,
      maxX: updated.reliefSource.physicalWidthMm,
      maxY: updated.reliefSource.physicalHeightMm,
    };
  }
  const aspect = current.bounds.maxX > 0 ? current.bounds.maxY / current.bounds.maxX : 1;
  return {
    minX: 0,
    minY: 0,
    maxX: updated.targetWidthMm,
    maxY: updated.targetWidthMm * aspect,
  };
}
