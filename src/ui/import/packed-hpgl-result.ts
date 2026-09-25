import type { HpglDiagnostic, ParseHpglResult } from '../../io/hpgl';
import {
  packDxfResult,
  packedDxfTransferables,
  unpackDxfResult,
  type PackedDxfResult,
} from './packed-dxf-result';

// HPGL and DXF share the ImportedSvg domain model. Reuse the established typed
// geometry codec while keeping HPGL diagnostics separate from DXF skip notes.
export type PackedHpglResult = {
  readonly geometry: PackedDxfResult;
  readonly diagnostics: readonly HpglDiagnostic[];
};

export function packHpglResult(result: ParseHpglResult): PackedHpglResult {
  const geometry =
    result.kind === 'error'
      ? { kind: 'error' as const, reason: result.reason }
      : {
          kind: 'ok' as const,
          object: result.object,
          pathCount: result.pathCount,
          notes: result.notes,
          skippedSummary: null,
        };
  return { geometry: packDxfResult(geometry), diagnostics: result.diagnostics };
}

export function unpackHpglResult(result: PackedHpglResult): ParseHpglResult {
  const geometry = unpackDxfResult(result.geometry);
  if (geometry.kind === 'error') return { ...geometry, diagnostics: result.diagnostics };
  return {
    kind: 'ok',
    object: geometry.object,
    pathCount: geometry.pathCount,
    notes: geometry.notes,
    diagnostics: result.diagnostics,
  };
}

export function packedHpglTransferables(result: PackedHpglResult): ReadonlyArray<ArrayBuffer> {
  return packedDxfTransferables(result.geometry);
}
