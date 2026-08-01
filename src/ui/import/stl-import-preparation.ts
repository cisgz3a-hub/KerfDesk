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
      readonly positions: Float32Array;
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
  const probe = meshToHeightmap(parsed.mesh, options);
  if (probe.kind === 'error') return probe;
  return {
    kind: 'ok',
    positions: parsed.mesh.positions,
    widthMm: probe.widthMm,
    heightMm: probe.heightMm,
    format: parsed.format,
  };
}
