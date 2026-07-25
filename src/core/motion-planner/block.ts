// Motion-planner block model (extracted from core/job/planner.ts, ADR-255
// stage 8a — pure move, no behavior change).
//
// A Block is one straight move between two vertices at a target velocity.
// Both the job duration estimator and the G-code Inspector's time model
// plan over the same Block shape, so they cannot drift apart.

import type { Vec2 } from '../scene';

export type BlockKind = 'cut' | 'travel';
export type BlockMotion = 'rapid' | 'feed';

export type Block = {
  readonly kind: BlockKind;
  // Timing/accounting and kinematic continuity are independent. A G1/S0
  // runway is travel for the operator-facing breakdown but feed motion for
  // junction planning, so it must blend into the following powered G1.
  readonly motion?: BlockMotion;
  readonly distance: number; // mm
  readonly targetVelocity: number; // mm/sec
  /** Legacy narrow tag for a continuous S0/burn chain without motion metadata. */
  readonly feedMatchedLaserMotion?: boolean;
  // Unit direction vector. Travels with zero length are filtered out
  // before block creation so this is always defined for real blocks.
  readonly direction: Vec2;
};

export function blockMotion(block: Block): BlockMotion {
  return block.motion ?? (block.kind === 'cut' ? 'feed' : 'rapid');
}
