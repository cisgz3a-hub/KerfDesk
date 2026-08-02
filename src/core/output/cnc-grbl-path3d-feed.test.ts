// Feed selection for path3d (per-vertex XYZ) passes. Split from
// cnc-grbl-strategy.test.ts at the 400-line cap; the rest of the emitter's
// behaviour stays there.
//
// The operator configures two rates: a cutting feed and a plunge feed. On a
// sloped cutting move both apply at once — the move travels at the cutting
// feed while its Z component descends at feed·|dz|/length3d. ADR-282
// Amendment 5 emits exactly that: full cutting feed where the profile is flat,
// reduced only as much as a descent needs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { scanGcodeWords } from '../gcode';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

const dev = DEFAULT_DEVICE_PROFILE;
const CUTTING_FEED = 1000;
const PLUNGE_FEED = 300;

type FeedState = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly feed: number;
};

function path3dGroup(
  points: ReadonlyArray<{ x: number; y: number; z: number }>,
  lateralFeed?: 'plunge' | 'z-rate-capped',
): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'v-carve',
    toolDiameterMm: 6,
    feedMmPerMin: CUTTING_FEED,
    plungeMmPerMin: PLUNGE_FEED,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'path3d',
        points,
        closed: false,
        ...(lateralFeed === undefined ? {} : { lateralFeed }),
      },
    ],
  };
}

// Z speed of every emitted descent, read back off the program text so the
// assertion measures what the controller will actually do.
function descentRates(gcode: string): ReadonlyArray<number> {
  const rates: number[] = [];
  let state: FeedState = { x: 0, y: 0, z: 0, feed: 0 };
  let motion: GcodeMotionMode | null = 0;
  for (const line of gcode.split('\n')) {
    const scanned = scanModalMotionLine(line, motion);
    motion = scanned.motion;
    if (!scanned.isMotion || (motion !== 0 && motion !== 1)) continue;
    const next = nextFeedState(line, state);
    const rate = descentRate(state, next, motion);
    if (rate !== null) rates.push(rate);
    state = next;
  }
  return rates;
}

function nextFeedState(line: string, state: FeedState): FeedState {
  const words = scanGcodeWords(line);
  const value = (letter: string): number | undefined => {
    return words.find((word) => word.letter === letter)?.value;
  };
  return {
    x: value('X') ?? state.x,
    y: value('Y') ?? state.y,
    z: value('Z') ?? state.z,
    feed: value('F') ?? state.feed,
  };
}

function descentRate(state: FeedState, next: FeedState, motion: GcodeMotionMode): number | null {
  if (motion !== 1 || next.z >= state.z || !(next.feed > 0)) return null;
  const dz = state.z - next.z;
  const length3d = Math.hypot(next.x - state.x, next.y - state.y, dz);
  return length3d > 0 ? (next.feed * dz) / length3d : null;
}

describe('path3d lateral feed selection', () => {
  it('keeps the cutting feed on the flat parts of a z-rate-capped profile', () => {
    // A V-carve detail ring is mostly flat with occasional descents. Riding the
    // plunge feed for the whole ring made the flat majority 3.3x slower than
    // the operator's cutting feed for no motion-safety gain — a flat move has
    // no Z component to limit.
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          path3dGroup(
            [
              { x: 10, y: 10, z: -1 },
              { x: 20, y: 10, z: -1 }, // flat
              { x: 30, y: 10, z: -2 }, // 10 mm lateral, 1 mm drop — shallow
            ],
            'z-rate-capped',
          ),
        ],
      },
      dev,
    );

    expect(gcode).toContain('G1X20.000Y10.000Z-1.000F1000');
    // len3d = hypot(10, 1) = 10.0499, so the cap 300*10.0499/1 = 3014 mm/min
    // exceeds the cutting feed: a shallow descent is not slowed at all.
    expect(gcode).toContain('X30.000Y10.000Z-2.000');
    expect(gcode).not.toContain('Z-2.000F300');
  });

  it('slows a steep z-rate-capped descent to the configured plunge rate', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          path3dGroup(
            [
              { x: 10, y: 10, z: -1 },
              { x: 11, y: 10, z: -3 }, // 1 mm lateral, 2 mm drop — steep
            ],
            'z-rate-capped',
          ),
        ],
      },
      dev,
    );

    // len3d = hypot(1, 2) = 2.23606; floor(300 * 2.23606 / 2) = 335.
    expect(gcode).toContain('G1X11.000Y10.000Z-3.000F335');
  });

  it('keeps the cutting feed while a z-rate-capped profile rises', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          path3dGroup(
            [
              { x: 10, y: 10, z: -3 },
              { x: 11, y: 10, z: -1 },
            ],
            'z-rate-capped',
          ),
        ],
      },
      dev,
    );

    expect(gcode).toContain('G1X11.000Y10.000Z-1.000F1000');
  });

  it('never emits a descent faster than the plunge rate, at any slope', () => {
    // The invariant the cap exists for, swept across slopes from nearly flat to
    // nearly vertical. floor() rather than round() keeps every rate inside the
    // limit instead of a fraction above it.
    for (const drop of [0.05, 0.2, 1, 2, 5, 20]) {
      const gcode = cncGrblStrategy.emit(
        {
          groups: [
            path3dGroup(
              [
                { x: 10, y: 10, z: 0 },
                { x: 11, y: 10, z: -drop },
              ],
              'z-rate-capped',
            ),
          ],
        },
        dev,
      );
      for (const rate of descentRates(gcode)) {
        expect(rate).toBeLessThanOrEqual(PLUNGE_FEED + 1e-9);
      }
    }
  });

  it('leaves entry ramps on the plunge feed — ADR-278 motion is unchanged', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          path3dGroup(
            [
              { x: 10, y: 10, z: 0 },
              { x: 20, y: 10, z: -0.5 },
              { x: 20, y: 20, z: -1 },
            ],
            'plunge',
          ),
        ],
      },
      dev,
    );

    expect(gcode).toContain('G1 X20.000 Y10.000 Z-0.500 F300');
    expect(gcode).not.toContain('G1 X20.000 Y10.000 Z-0.500 F1000');
  });

  it('leaves an untagged path3d pass on the cutting feed', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          path3dGroup([
            { x: 10, y: 10, z: -1 },
            { x: 20, y: 10, z: -2 },
          ]),
        ],
      },
      dev,
    );

    expect(gcode).toContain('G1 X20.000 Y10.000 Z-2.000 F1000');
  });
});
