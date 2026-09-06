// Planner-true time for a parsed G-code program (ADR-255 stage 8b).
// Plans over core/motion-planner with caller-selected machine assumptions
// and optional motion-time calibration.

export {
  buildProgramTime,
  type ProgramTimeCalibration,
  type ProgramTimeModel,
} from './program-time';
export {
  buildGcodeTimingPlan,
  plannedProgressAtRoute,
  plannedProgressAtSendableLine,
  plannedSecondsAtRoute,
  type GcodeTimingPlan,
  type GcodeTimingPlanOptions,
  type GcodeTimingPlanResult,
  type PlannedProgramProgress,
} from './gcode-timing-plan';
export {
  buildProgramTimeline,
  type ProgramPauseBarrier,
  type ProgramTimeline,
  type ProgramTimelineOptions,
  type ProgramTimelineResult,
} from './program-timeline';
export { sanitizeLimits, SECONDS_PER_MINUTE, type MotionLimits } from './motion-limits';
export { segmentBlocks } from './segment-blocks';
