import { meshToHeightmap } from '../../core/relief';
import { legacyMeshIntrinsicBounds } from '../../core/relief/legacy-mesh';
import type { ReliefMeshIntrinsicBounds, ReliefMeshWidthAspect } from '../../core/scene/relief';
import type { ParseStlResult } from '../../io/stl';

export type StlImportPreparationOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell: number;
};

export type PreparedStlImportResult =
  | {
      readonly kind: 'ok';
      readonly positions: Float32Array;
      readonly widthMm: number;
      readonly heightMm: number;
      readonly intrinsicBounds: ReliefMeshIntrinsicBounds;
      readonly widthAspect: ReliefMeshWidthAspect;
      readonly format: 'binary' | 'ascii';
    }
  | { readonly kind: 'error'; readonly reason: string };

export function prepareParsedStlImport(
  parsed: ParseStlResult,
  options: StlImportPreparationOptions,
): PreparedStlImportResult {
  if (parsed.kind === 'error') return parsed;
  const intrinsicBounds = legacyMeshIntrinsicBounds(parsed.mesh.positions);
  const probe = meshToHeightmap(
    intrinsicBounds.kind === 'finite-float32-v1'
      ? { positions: parsed.mesh.positions, intrinsicBounds }
      : parsed.mesh,
    options,
  );
  if (probe.kind === 'error') return probe;
  return {
    kind: 'ok',
    positions: parsed.mesh.positions,
    widthMm: probe.widthMm,
    heightMm: probe.heightMm,
    intrinsicBounds,
    widthAspect: 'preserve',
    format: parsed.format,
  };
}
