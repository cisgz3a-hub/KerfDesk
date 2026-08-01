import type { BuildRenderModelResult } from '../../core/gcode-view';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import type { GcodeSourceLineIndex } from './gcode-source-line-index';

export const INSPECTOR_RENDER_PRESSURE_THRESHOLD = 250_000;

export type GcodeInspectorWorkerRequest = {
  readonly id: number;
  readonly source: GcodeInspectionSource;
};

export type GcodeInspectorWorkerResult = {
  readonly parsed: BuildRenderModelResult;
  readonly sourceIndex: GcodeSourceLineIndex;
  readonly sourceLineCount: number;
};

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
