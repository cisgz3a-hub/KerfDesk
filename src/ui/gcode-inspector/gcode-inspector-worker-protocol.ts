import type { BuildRenderModelResult } from '../../core/gcode-view';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';

export const INSPECTOR_RENDER_PRESSURE_THRESHOLD = 250_000;

export type GcodeInspectorWorkerRequest = {
  readonly id: number;
  readonly source: GcodeInspectionSource;
};

type GcodeInspectorWorkerResultBase = {
  readonly sourceIndex: GcodeSourceLineIndex;
  readonly sourceLineCount: number;
};

export type SuccessfulGcodeInspectorWorkerResult = GcodeInspectorWorkerResultBase & {
  readonly parsed: Extract<BuildRenderModelResult, { readonly kind: 'ok' }>;
  readonly analysis: GcodeInspectorAnalysis;
};

type FailedGcodeInspectorWorkerResult = GcodeInspectorWorkerResultBase & {
  readonly parsed: Extract<BuildRenderModelResult, { readonly kind: 'error' }>;
  readonly analysis: null;
};

export type GcodeInspectorWorkerResult =
  | SuccessfulGcodeInspectorWorkerResult
  | FailedGcodeInspectorWorkerResult;

export function hasGcodeInspectorAnalysis(
  result: GcodeInspectorWorkerResult,
): result is SuccessfulGcodeInspectorWorkerResult {
  return result.parsed.kind === 'ok';
}

export type GcodeInspectorWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly phase: 'reading' | 'parsing';
      readonly bytesRead?: number;
      readonly totalBytes?: number;
    }
  | { readonly id: number; readonly kind: 'complete'; readonly result: GcodeInspectorWorkerResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
