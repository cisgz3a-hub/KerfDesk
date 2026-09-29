import { describe, expect, it } from 'vitest';
import type { Block } from './block';
import { junctionVelocity } from './junction';
import { planVelocities } from './plan-velocities';

const ACCEL = 500;
const JD = 0.01;

function move(distance: number, targetVelocity: number, headingDeg = 0): Block {
  const radians = (headingDeg * Math.PI) / 180;
  return {
    kind: 'cut',
    distance,
    targetVelocity,
    direction: { x: Math.cos(radians), y: Math.sin(radians) },
  };
}

// A streaming GRBL planner written from planner.c, not from planVelocities.
// While block i executes, the ring holds blocks i to i + size - 1 and plans
// the newest of them to end at rest (planner_recalculate), so block i may
// leave only as fast as the blocks behind it in the ring can still stop.
function ringExitSpeeds(blocks: ReadonlyArray<Block>, size: number): number[] {
  const maxEntrySq = blocks.map((block, index) => {
    const previous = blocks[index - 1];
    if (previous === undefined) return 0;
    const junction = junctionVelocity(previous, block, ACCEL, JD);
    return Math.min(junction, previous.targetVelocity, block.targetVelocity) ** 2;
  });
  const exits: number[] = [];
  let entrySq = 0;
  blocks.forEach((block, index) => {
    const newest = Math.min(blocks.length, index + size) - 1;
    let nextEntrySq = 0;
    for (let k = newest; k > index; k -= 1) {
      const distance = blocks[k]?.distance ?? 0;
      nextEntrySq = Math.min(maxEntrySq[k] ?? 0, nextEntrySq + 2 * ACCEL * distance);
    }
    const exitSq = Math.min(
      nextEntrySq,
      entrySq + 2 * ACCEL * block.distance,
      block.targetVelocity ** 2,
    );
    exits.push(Math.sqrt(exitSq));
    entrySq = exitSq;
  });
  return exits;
}

// Short moves with corners, reversals and speed changes, like a raster row
// followed by a small outline.
function mixedMoves(): Block[] {
  const blocks: Block[] = [];
  for (let index = 0; index < 60; index += 1) blocks.push(move(0.1, 100));
  blocks.push(move(0.5, 100, 90), move(0.1, 20, 180));
  for (let index = 0; index < 40; index += 1) blocks.push(move(0.1, 100, 180));
  for (let index = 0; index < 24; index += 1) blocks.push(move(0.8, 50, index * 15));
  blocks.push(move(12, 100), move(0.05, 100, 3), move(3, 10, 3));
  return blocks;
}

describe('planVelocities with a finite planner (ADR-525)', () => {
  it('matches a model of a streaming GRBL planner ring of any size', () => {
    const blocks = mixedMoves();
    for (const size of [1, 2, 4, 15, 32, 100]) {
      const planned = planVelocities(blocks, ACCEL, JD, size).map((entry) => entry.exitV);
      const expected = ringExitSpeeds(blocks, size);
      planned.forEach((exit, index) => expect(exit).toBeCloseTo(expected[index] ?? NaN, 9));
    }
  });

  it('caps a fine raster row at the speed that can still stop within the ring', () => {
    // 400 moves of 0.1 mm at 100 mm/s. Unlimited lookahead cruises at the
    // feed; a 15-block ring can only ever see 14 moves (1.4 mm) past the one
    // executing, so the head settles at sqrt(2 a 1.4 mm) = 37.4 mm/s.
    const row = Array.from({ length: 400 }, () => move(0.1, 100));
    const middle = 200;
    expect(planVelocities(row, ACCEL, JD)[middle]?.entryV).toBeCloseTo(100, 9);
    expect(planVelocities(row, ACCEL, JD, 15)[middle]?.entryV).toBeCloseTo(
      Math.sqrt(2 * ACCEL * 1.4),
      9,
    );
  });

  it('plans a span the ring can hold whole exactly as unlimited lookahead', () => {
    const blocks = mixedMoves();
    expect(planVelocities(blocks, ACCEL, JD, blocks.length)).toEqual(
      planVelocities(blocks, ACCEL, JD),
    );
  });

  it('ignores a planner size that is not a whole number of blocks', () => {
    const blocks = mixedMoves();
    const unlimited = planVelocities(blocks, ACCEL, JD);
    for (const size of [0, -3, 2.5, Number.NaN]) {
      expect(planVelocities(blocks, ACCEL, JD, size)).toEqual(unlimited);
    }
  });
});
