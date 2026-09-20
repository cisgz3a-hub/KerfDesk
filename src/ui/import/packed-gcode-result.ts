// Transfer shape for an imported G-code program's route (ADR-254). The step
// codec itself lives in core/job/packed-toolpath.ts, which this and the
// preview's packed routes share; what stays here is the program's own
// summary and notes and the worker message wrapper.
//
// Unchecked packing on purpose: a parsed program's steps only ever carry
// fields this layout has a column for, and the importer's round-trip tests
// pin that. A route that might carry per-vertex Z or a tool id goes through
// packToolpath, which refuses rather than dropping them.

import {
  packToolpathUnchecked,
  packedToolpathTransferables,
  unpackToolpathStep,
  type PackedToolpath,
} from '../../core/job/packed-toolpath';
import type { ParseGcodeProgramResult } from '../../io/gcode';

type PackedGcodeOk = PackedToolpath & {
  readonly kind: 'ok';
  readonly totalLength: number;
  readonly summary: Extract<ParseGcodeProgramResult, { kind: 'ok' }>['summary'];
  readonly notes: ReadonlyArray<string>;
};

export type PackedGcodeResult = { readonly kind: 'error'; readonly reason: string } | PackedGcodeOk;

export function packGcodeResult(result: ParseGcodeProgramResult): PackedGcodeResult {
  if (result.kind === 'error') return result;
  const steps = result.toolpath.steps;
  let pointCount = 0;
  let hasRasterSource = false;
  for (const step of steps) {
    if (step.kind !== 'cut') continue;
    pointCount += step.polyline.length;
    hasRasterSource ||= step.source !== undefined;
  }
  return {
    kind: 'ok',
    totalLength: result.toolpath.totalLength,
    summary: result.summary,
    notes: result.notes,
    ...packToolpathUnchecked(steps, pointCount, hasRasterSource),
  };
}

export function unpackGcodeResult(result: PackedGcodeResult): ParseGcodeProgramResult {
  if (result.kind === 'error') return result;
  const steps = Array.from({ length: result.stepKinds.length }, (_, index) =>
    unpackToolpathStep(result, index),
  );
  return {
    kind: 'ok',
    toolpath: { steps, totalLength: result.totalLength },
    summary: result.summary,
    notes: result.notes,
  };
}

export function packedGcodeTransferables(result: PackedGcodeResult): ReadonlyArray<ArrayBuffer> {
  return result.kind === 'error' ? [] : packedToolpathTransferables(result);
}
