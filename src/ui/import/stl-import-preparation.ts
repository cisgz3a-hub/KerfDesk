import { meshToHeightmap } from '../../core/relief';
import type { ParseStlResult } from '../../io/stl';

export type StlImportPreparationOptions = {
  readonly targetWidthMm: number;
  readonly reliefDepthMm: number;
  readonly mmPerCell: number;
};

export type PreparedStlImportResult =
  | {
      readonly kind: 'ok';
      readonly positions: Float32Array | Float64Array;
      readonly widthMm: number;
      readonly heightMm: number;
      readonly format: 'binary' | 'ascii';
    }
  | { readonly kind: 'error'; readonly reason: string };

export function prepareParsedStlImport(
  parsed: ParseStlResult,
  options: StlImportPreparationOptions,
): PreparedStlImportResult {
  if (parsed.kind === 'error') return parsed;
  const positions = topViewPositions(parsed.mesh.positions);
  const probe = meshToHeightmap({ positions }, options);
  if (probe.kind === 'error') return probe;
  return {
    kind: 'ok',
    positions,
    widthMm: probe.widthMm,
    heightMm: probe.heightMm,
    format: parsed.format,
  };
}

/**
 * ADR-414: an STL is modelled Z-up and read from above with +Y toward the top
 * of the view (the back of the model). The relief grid places its first row at
 * the top of the Y-down canvas, which is the model's MINIMUM Y, so an embedded
 * mesh taken verbatim came out mirrored front-to-back: raised text came
 * out flipped top-to-bottom. Negating Y once at import stores the mesh in the
 * canvas frame, so the canvas, the 3D views and the carve all match the CAD top
 * view. The flip happens here and not in the shared rasterizer so meshes that
 * projects already store keep the orientation they were saved and cut with.
 */
function topViewPositions(positions: Float32Array | Float64Array): Float32Array | Float64Array {
  const flipped =
    positions instanceof Float64Array
      ? new Float64Array(positions.length)
      : new Float32Array(positions.length);
  for (let index = 0; index < positions.length; index += 1) {
    const value = positions[index] ?? 0;
    // 0 - value keeps an exact zero positive instead of writing -0.
    flipped[index] = index % 3 === 1 ? 0 - value : value;
  }
  return flipped;
}
