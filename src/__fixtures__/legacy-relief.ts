import { legacyMeshIntrinsicBounds } from '../core/relief/legacy-mesh';
import type { MeshReliefObject, ReliefMeshWidthAspect } from '../core/scene/relief';

export type TestLegacyMeshGeometryInput = {
  readonly positions: ReadonlyArray<number> | Float32Array;
  readonly targetWidthMm: number;
  readonly targetHeightMm?: number;
  readonly widthAspect?: ReliefMeshWidthAspect;
  readonly emptyCells?: 'floor' | 'top';
};

/** Build internally consistent schema-v5 legacy geometry for cross-layer tests. */
export function testLegacyMeshGeometry(
  input: TestLegacyMeshGeometryInput,
): Pick<MeshReliefObject, 'targetHeightMm' | 'widthAspect' | 'reliefSource'> {
  const intrinsicBounds = legacyMeshIntrinsicBounds(input.positions);
  const derivedHeightMm = derivedTargetHeightMm(intrinsicBounds, input.targetWidthMm);
  const targetHeightMm = input.targetHeightMm ?? derivedHeightMm ?? input.targetWidthMm;
  const widthAspect = input.widthAspect ?? (derivedHeightMm === null ? 'stretch' : 'preserve');
  return {
    targetHeightMm,
    widthAspect,
    reliefSource: {
      kind: 'legacy-mesh',
      meshPositions: input.positions,
      emptyCells: input.emptyCells ?? 'floor',
      intrinsicBounds,
    },
  };
}

function derivedTargetHeightMm(
  bounds: ReturnType<typeof legacyMeshIntrinsicBounds>,
  targetWidthMm: number,
): number | null {
  if (bounds.kind !== 'finite-float32-v1') return null;
  const xExtent = bounds.maxX - bounds.minX;
  const yExtent = bounds.maxY - bounds.minY;
  const heightMm = (yExtent / xExtent) * targetWidthMm;
  return positiveFinite(xExtent) && positiveFinite(yExtent) && positiveFinite(heightMm)
    ? heightMm
    : null;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
