import { buildProgramTime, type ProgramTimeModel } from '../../core/gcode-time';
import {
  findProgramIssues,
  type GcodeRenderModel,
  type ProgramFinding,
} from '../../core/gcode-view';

const INSPECTOR_ACCEL_MM_PER_SEC2 = 500;
const INSPECTOR_JUNCTION_DEVIATION_MM = 0.01;
const INSPECTOR_MAX_FEED_MM_PER_MIN = 6000;

/** Deterministic timeline and informational findings derived beside parsing. */
export type GcodeInspectorAnalysis = {
  readonly time: ProgramTimeModel;
  readonly findings: ReadonlyArray<ProgramFinding>;
};

/** Derives the fixed Inspector timeline and informational health report. */
export function analyzeGcodeModel(model: GcodeRenderModel): GcodeInspectorAnalysis {
  return {
    time: buildProgramTime(model, {
      accelMmPerSec2: INSPECTOR_ACCEL_MM_PER_SEC2,
      junctionDeviationMm: INSPECTOR_JUNCTION_DEVIATION_MM,
      maxFeedMmPerMin: INSPECTOR_MAX_FEED_MM_PER_MIN,
    }),
    findings: findProgramIssues(model),
  };
}
