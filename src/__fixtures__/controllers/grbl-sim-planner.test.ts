// Tests the measuring instrument first (ADR-025 discipline): the withheld-ack
// rule below is the whole point of the model, so it is pinned before any
// streaming proof leans on it.

import { describe, expect, it } from 'vitest';
import {
  admitBlock,
  createPlanner,
  GRBL_PLANNER_BLOCKS,
  GRBLHAL_PLANNER_BLOCKS,
  isPlannerBlocked,
  isPlannerFull,
  outstandingMotions,
  retireBlock,
  withholdAck,
  wipePlanner,
  type GrblSimPlanner,
} from './grbl-sim-planner';

/** Fill every slot of a fresh planner of the given depth. */
function saturate(capacity: number): GrblSimPlanner {
  let planner = createPlanner(capacity);
  for (let i = 0; i < capacity; i += 1) planner = admitBlock(planner);
  return planner;
}

describe('grbl-sim-planner', () => {
  it('pins the planner depths read from grbl and grblHAL source', () => {
    expect(GRBL_PLANNER_BLOCKS).toBe(16);
    expect(GRBLHAL_PLANNER_BLOCKS).toBe(100);
  });

  it('accepts blocks up to capacity and only then reports full', () => {
    const planner = saturate(3);
    expect(planner.blocks).toBe(3);
    expect(isPlannerFull(planner)).toBe(true);
    expect(isPlannerBlocked(planner)).toBe(false);
  });

  it('is not blocked while merely full — blocking needs a line waiting on it', () => {
    // A full planner stalls nothing until a line actually arrives at it. Until
    // then the main loop is free, which is why the two predicates differ.
    expect(isPlannerBlocked(saturate(2))).toBe(false);
    expect(isPlannerBlocked(withholdAck(saturate(2), 'G1 X9'))).toBe(true);
  });

  it('withholds the ack of a line that arrives at a full planner', () => {
    const planner = withholdAck(saturate(2), 'G1 X9 F600');
    expect(planner.withheldAck).toBe('G1 X9 F600');
    expect(planner.blocks).toBe(2);
    // The parser already ran, so the motion is outstanding even un-admitted.
    expect(outstandingMotions(planner)).toBe(3);
  });

  it('releases the withheld ack as soon as a block retires, and admits it', () => {
    const retired = retireBlock(withholdAck(saturate(2), 'G1 X9'));
    expect(retired.releasedAck).toBe('G1 X9');
    expect(retired.planner.withheldAck).toBeNull();
    expect(retired.planner.blocks).toBe(2);
    expect(isPlannerBlocked(retired.planner)).toBe(false);
    expect(outstandingMotions(retired.planner)).toBe(2);
  });

  it('drains one block per retirement when nothing is waiting', () => {
    const first = retireBlock(saturate(2));
    expect(first.releasedAck).toBeNull();
    expect(first.planner.blocks).toBe(1);
    const second = retireBlock(first.planner);
    expect(second.planner.blocks).toBe(0);
  });

  it('retiring an empty planner is a no-op, not an underflow', () => {
    const retired = retireBlock(createPlanner(4));
    expect(retired.planner.blocks).toBe(0);
    expect(retired.releasedAck).toBeNull();
  });

  it('a wipe discards queued blocks and any withheld ack, as a soft reset does', () => {
    const wiped = wipePlanner(withholdAck(saturate(4), 'G1 X9'));
    expect(wiped.blocks).toBe(0);
    expect(wiped.withheldAck).toBeNull();
    expect(isPlannerBlocked(wiped)).toBe(false);
    expect(wiped.capacity).toBe(4);
  });
});
