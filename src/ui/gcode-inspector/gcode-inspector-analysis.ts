import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import {
  findProgramIssues,
  type GcodeRenderModel,
  type ProgramFinding,
} from '../../core/gcode-view';
import type { GcodeInspectionContext } from './gcode-inspection-source';
import { inspectorProgramTime, type InspectorProgramTime } from './inspector-model';
import type { ProgramToolMark } from './program-tools';

// Stock GRBL kinematics, only for a program with no device to time it for.
const STOCK_LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

/** Deterministic timeline and informational findings derived beside parsing. */
export type GcodeInspectorAnalysis = {
  readonly time: InspectorProgramTime;
  readonly findings: ReadonlyArray<ProgramFinding>;
  /** Whose kinematics the time assumes: a device profile name, or null for stock GRBL. */
  readonly timedFor: string | null;
  /** Tools the program names in comments, for the Tool lens and Studio (ADR-426). */
  readonly toolMarks: ReadonlyArray<ProgramToolMark>;
};

/** Derives the Inspector timeline and informational health report. The time
 * plans against the device the context names, as Job Review does (ADR-425). */
export function analyzeGcodeModel(
  model: GcodeRenderModel,
  context: GcodeInspectionContext = {},
  toolMarks: ReadonlyArray<ProgramToolMark> = [],
): GcodeInspectorAnalysis {
  const timing = context.timing;
  return {
    time: inspectorProgramTime(
      model,
      buildProgramTime(model, timing?.limits ?? STOCK_LIMITS, {
        ...(timing?.cutTimeScale === undefined ? {} : { cutTimeScale: timing.cutTimeScale }),
        ...(timing?.travelTimeScale === undefined
          ? {}
          : { travelTimeScale: timing.travelTimeScale }),
        ...(context.machineKind === undefined ? {} : { machineKind: context.machineKind }),
      }),
    ),
    findings: findProgramIssues(model),
    timedFor: timing?.deviceName ?? null,
    toolMarks,
  };
}
