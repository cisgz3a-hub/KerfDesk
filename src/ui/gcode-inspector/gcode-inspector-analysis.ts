import { buildProgramTime, type ProgramTimeModel } from '../../core/gcode-time';
import {
  findProgramIssues,
  type GcodeRenderModel,
  type ProgramFinding,
} from '../../core/gcode-view';

export type GcodeInspectorAnalysis = {
  readonly time: ProgramTimeModel;
  readonly findings: ReadonlyArray<ProgramFinding>;
};

/** Derives the fixed Inspector timeline and informational health report. */
export function analyzeGcodeModel(model: GcodeRenderModel): GcodeInspectorAnalysis {
  return {
    time: buildProgramTime(model, {
      accelMmPerSec2: 500,
      junctionDeviationMm: 0.01,
      maxFeedMmPerMin: 6000,
    }),
    findings: findProgramIssues(model),
  };
}
