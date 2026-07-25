// Planner-true time for a parsed G-code program (ADR-255 stage 8b).
// Plans over core/motion-planner — the same kinematics as the job duration
// estimator — so the Inspector's clock cannot drift from Job Review's.

export { buildProgramTime, type ProgramTimeModel } from './program-time';
export { sanitizeLimits, SECONDS_PER_MINUTE, type MotionLimits } from './motion-limits';
export { segmentBlocks } from './segment-blocks';
