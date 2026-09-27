import type { BuildRenderModelResult } from '../../core/gcode-view';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeInspectorAnalysis } from './gcode-inspector-analysis';
import type { InspectorRenderModel } from './inspector-model';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';
import type { PreviewChunk } from './inspection-preview';

export const INSPECTOR_RENDER_PRESSURE_THRESHOLD = 250_000;

export type GcodeInspectorWorkerRequest = {
  readonly id: number;
  readonly source: GcodeInspectionSource;
};

type GcodeInspectorWorkerResultBase = {
  readonly sourceIndex: GcodeSourceLineIndex;
  readonly sourceLineCount: number;
};

/** A parsed render model paired with all analysis required by the Inspector UI. */
export type SuccessfulGcodeInspectorWorkerResult = GcodeInspectorWorkerResultBase & {
  /** Only what the Inspector reads; timing's working arrays stay in the worker (ADR-485). */
  readonly parsed: { readonly kind: 'ok'; readonly model: InspectorRenderModel };
  readonly analysis: GcodeInspectorAnalysis;
};

type FailedGcodeInspectorWorkerResult = GcodeInspectorWorkerResultBase & {
  readonly parsed: Extract<BuildRenderModelResult, { readonly kind: 'error' }>;
  readonly analysis: null;
};

export type GcodeInspectorWorkerResult =
  | SuccessfulGcodeInspectorWorkerResult
  | FailedGcodeInspectorWorkerResult;

/** Narrows a Worker result to its successful parsed-and-analyzed form. */
export function hasGcodeInspectorAnalysis(
  result: GcodeInspectorWorkerResult,
): result is SuccessfulGcodeInspectorWorkerResult {
  return result.parsed.kind === 'ok';
}

export type GcodeInspectorWorkerResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      /** Timing: the source is read and the worker times the moves (ADR-485). */
      readonly phase: 'reading' | 'parsing' | 'timing';
      readonly bytesRead?: number;
      readonly totalBytes?: number;
    }
  /** The moves read since the last preview, while the worker reads (ADR-485). */
  | { readonly id: number; readonly kind: 'preview'; readonly chunk: PreviewChunk }
  | { readonly id: number; readonly kind: 'complete'; readonly result: GcodeInspectorWorkerResult }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };
