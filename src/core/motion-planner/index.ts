// Shared GRBL-style motion kinematics (ADR-255 stage 8a).
//
// Extracted from core/job/planner.ts so the job duration estimator and the
// G-code Inspector's time model plan over the SAME physics instead of two
// copies that can drift. Pure: no clock, no randomness, no I/O.

export { blockMotion, type Block, type BlockKind, type BlockMotion } from './block';
export { junctionVelocity } from './junction';
export { planVelocities, type PlanEntry } from './plan-velocities';
export { blockTime } from './block-time';
