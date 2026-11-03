import { describe, expect, it } from 'vitest';
import type { MachineKinematics } from '../devices/device-profile';
import type { Block } from './block';
import { blockTime } from './block-time';
import { ColumnarPlan } from './columnar-plan';
import { planVelocities } from './plan-velocities';
import { blockAcceleration } from './planner-kinematics';

// Deterministic blocks that reach every branch of the passes: axis, diagonal,
// 3D and reversing directions, zero and tiny lengths, rapid/feed changes,
// stops after a block and feed-matched laser chains.
function blocks(seed: number, count: number): Block[] {
  let state = seed;
  const next = (): number => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state / 2 ** 32;
  };
  const out: Block[] = [];
  let previous: Direction = { x: 1, y: 0, z: 0 };
  for (let i = 0; i < count; i += 1) {
    const direction = nextDirection(next, previous);
    previous = direction;
    const d = next();
    out.push({
      kind: next() < 0.6 ? 'cut' : 'travel',
      motion: next() < 0.7 ? 'feed' : 'rapid',
      distance: d < 0.05 ? 0 : d < 0.4 ? next() * 0.1 : next() * 40,
      targetVelocity: next() < 0.5 ? 100 : 5 + next() * 300,
      direction,
      ...(next() < 0.05 ? { stopAfter: true } : {}),
      ...(next() < 0.3 ? { feedMatchedLaserMotion: true } : {}),
    });
  }
  return out;
}

// Bidirectional raster rows of 0.1 mm pixels at speeds a short planner window
// cannot reach, after a lead-in move of `leadInMm`.
function rasterBlocks(leadInMm: number): Block[] {
  const out: Block[] = [];
  if (leadInMm > 0) {
    out.push({
      kind: 'travel',
      motion: 'feed',
      distance: leadInMm,
      targetVelocity: 100,
      direction: { x: 1, y: 0 },
    });
  }
  for (let row = 0; row < 12; row += 1) {
    const x = row % 2 === 0 ? 1 : -1;
    for (let pixel = 0; pixel < 300; pixel += 1) {
      out.push({
        kind: pixel % 7 < 4 ? 'cut' : 'travel',
        motion: 'feed',
        distance: 0.1 + (pixel % 3) * 0.013,
        targetVelocity: [80, 250, 600][row % 3]!,
        direction: { x, y: 0 },
        feedMatchedLaserMotion: true,
      });
    }
    out.push({
      kind: 'travel',
      motion: 'feed',
      distance: 0.1,
      targetVelocity: 80,
      direction: { x: 0, y: 1 },
    });
  }
  return out;
}

type Direction = { readonly x: number; readonly y: number; readonly z: number };

function nextDirection(next: () => number, previous: Direction): Direction {
  const r = next();
  if (r < 0.2) return { x: next() < 0.5 ? 1 : -1, y: 0, z: 0 };
  if (r < 0.3) return { x: -previous.x, y: -previous.y, z: -previous.z };
  if (r < 0.4) return previous;
  if (r < 0.45) return { x: 0, y: 0, z: next() < 0.5 ? 1 : -1 };
  const angle = next() * 2 * Math.PI;
  const z = next() < 0.2 ? next() - 0.5 : 0;
  const planar = Math.sqrt(1 - z * z);
  return { x: Math.cos(angle) * planar, y: Math.sin(angle) * planar, z };
}

function expectSamePlan(
  input: ReadonlyArray<Block>,
  plannerBlocks: number | undefined,
  kinematics: MachineKinematics,
): void {
  const accel = 1_500;
  const jd = 0.013;
  const expected = planVelocities(input, accel, jd, plannerBlocks, kinematics);
  const plan = new ColumnarPlan(accel, jd, plannerBlocks, kinematics);
  for (const block of input) plan.push(block);
  let visited = 0;
  plan.finish((index, block, entryV, exitV, blockAccel) => {
    expect(index).toBe(visited);
    visited += 1;
    const source = input[index]!;
    const entry = expected[index]!;
    const sourceAccel = blockAcceleration(source, accel, kinematics);
    // Object.is: the very same doubles, not merely close ones.
    expect(Object.is(entryV, entry.entryV), `entry ${index}`).toBe(true);
    expect(Object.is(exitV, entry.exitV), `exit ${index}`).toBe(true);
    expect(Object.is(blockAccel, sourceAccel), `accel ${index}`).toBe(true);
    expect(block.kind).toBe(source.kind);
    expect(Object.is(block.distance, source.distance)).toBe(true);
    expect(Object.is(block.targetVelocity, source.targetVelocity)).toBe(true);
    const seconds = blockTime(block, entryV, exitV, blockAccel);
    const expectedSeconds = blockTime(source, entry.entryV, entry.exitV, sourceAccel);
    expect(Object.is(seconds, expectedSeconds), `time ${index}`).toBe(true);
  });
  expect(visited).toBe(input.length);
}

describe('ColumnarPlan', () => {
  const windows: ReadonlyArray<number | undefined> = [undefined, 1, 2, 3, 15, 16, 100, 1e9];
  for (const kinematics of ['cartesian', 'corexy'] as const) {
    for (const plannerBlocks of windows) {
      it(`plans the same doubles as planVelocities (${kinematics}, window ${plannerBlocks})`, () => {
        for (const seed of [1, 2, 3, 4]) {
          expectSamePlan(blocks(seed, 600), plannerBlocks, kinematics);
        }
      });
    }
  }

  it('plans spans shorter than the planner window, down to none', () => {
    for (const count of [0, 1, 2, 3, 5]) {
      for (const plannerBlocks of [1, 2, 4, 6, 16]) {
        expectSamePlan(blocks(count + 7, count), plannerBlocks, 'corexy');
        expectSamePlan(blocks(count + 7, count), plannerBlocks, 'cartesian');
      }
    }
  });

  it('ignores planner windows planVelocities ignores', () => {
    for (const plannerBlocks of [0, -3, 2.5, Number.NaN]) {
      expectSamePlan(blocks(21, 200), plannerBlocks, 'cartesian');
    }
  });

  it('plans raster rows, where the planner window sets the speed', () => {
    for (const plannerBlocks of [15, 16, 100]) {
      expectSamePlan(rasterBlocks(0), plannerBlocks, 'cartesian');
      expectSamePlan(rasterBlocks(0), plannerBlocks, 'corexy');
    }
  });

  it('keeps the distance sums of a long span exact', () => {
    // After a 10 km lead-in every running sum has lost the low bits of a
    // pixel; a window must subtract the same rounded sums planVelocities does.
    expectSamePlan(rasterBlocks(1e7), 15, 'cartesian');
    expectSamePlan(rasterBlocks(1e7), 100, 'corexy');
  });

  it('plans spans across its column chunks', () => {
    // The columns grow in chunks of 16,384 after a first chunk that doubles.
    for (const count of [256, 257, 16_385]) {
      expectSamePlan(blocks(count, count), 15, 'corexy');
    }
  }, 30_000);
});
