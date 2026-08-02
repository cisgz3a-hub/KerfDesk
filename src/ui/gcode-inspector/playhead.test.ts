import { describe, expect, it } from 'vitest';
import { buildProgramTime, type MotionLimits } from '../../core/gcode-time';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import { playheadAtTime, secondsAtLine } from './playhead';

const LIMITS: MotionLimits = {
  accelMmPerSec2: 500,
  junctionDeviationMm: 0.01,
  maxFeedMmPerMin: 6000,
};

function model(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function timed(text: string): {
  readonly model: GcodeRenderModel;
  readonly segTimeEndSec: Float32Array;
  readonly motionSeconds: number;
} {
  const built = model(text);
  const time = buildProgramTime(built, LIMITS);
  return { model: built, segTimeEndSec: time.segTimeEndSec, motionSeconds: time.motionSeconds };
}

// Three 10 mm moves: travel to (10,0), cut to (20,0), cut to (20,10).
const PROGRAM = ['G21 G90', 'M3 S1', 'G0 X10 Y0', 'G1 X20 Y0 F600', 'G1 X20 Y10'].join('\n');

describe('playheadAtTime', () => {
  it('interpolates within the active segment rather than snapping', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    // Halfway through the second segment's time span.
    const firstEnd = segTimeEndSec[0] ?? 0;
    const secondEnd = segTimeEndSec[1] ?? 0;
    const mid = firstEnd + (secondEnd - firstEnd) / 2;
    const state = playheadAtTime(built, segTimeEndSec, mid);
    expect(state.segmentIndex).toBe(1);
    expect(state.segmentFraction).toBeCloseTo(0.5, 3);
    // Segment 1 runs X10 → X20 at Y0, so mid-time lands between the ends.
    expect(state.point?.x).toBeGreaterThan(10);
    expect(state.point?.x).toBeLessThan(20);
    expect(state.point?.y).toBeCloseTo(0, 6);
  });

  it('clamps below zero and beyond the program end', () => {
    const { model: built, segTimeEndSec, motionSeconds } = timed(PROGRAM);
    const start = playheadAtTime(built, segTimeEndSec, -5);
    expect(start.routeMm).toBe(0);
    expect(start.point?.x).toBeCloseTo(0, 6);

    const end = playheadAtTime(built, segTimeEndSec, 9999);
    expect(end.routeMm).toBeCloseTo(motionSeconds, 6);
    expect(end.segmentIndex).toBe(2);
    expect(end.point?.x).toBeCloseTo(20, 6);
    expect(end.point?.y).toBeCloseTo(10, 6);
  });

  it('reports no point for a motionless program', () => {
    const { model: built, segTimeEndSec } = timed('G21 G90\nM3 S0\nM5');
    const state = playheadAtTime(built, segTimeEndSec, 5);
    expect(state.segmentIndex).toBe(-1);
    expect(state.point).toBeNull();
  });

  it('advances monotonically through the program', () => {
    const { model: built, segTimeEndSec, motionSeconds } = timed(PROGRAM);
    let previousIndex = -1;
    for (let step = 0; step <= 10; step += 1) {
      const state = playheadAtTime(built, segTimeEndSec, (motionSeconds * step) / 10);
      expect(state.segmentIndex).toBeGreaterThanOrEqual(previousIndex);
      previousIndex = state.segmentIndex;
    }
  });
});

describe('secondsAtLine', () => {
  it('returns the moment a line’s motion begins', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    expect(secondsAtLine(built, segTimeEndSec, 2)).toBe(0);
    expect(secondsAtLine(built, segTimeEndSec, 3)).toBeCloseTo(segTimeEndSec[0] ?? 0, 6);
    expect(secondsAtLine(built, segTimeEndSec, 4)).toBeCloseTo(segTimeEndSec[1] ?? 0, 6);
  });

  it('returns null for a line that produced no motion', () => {
    const { model: built, segTimeEndSec } = timed(PROGRAM);
    expect(secondsAtLine(built, segTimeEndSec, 0)).toBeNull();
  });

  // secondsAtLine binary-searches segLine, which is only sound because the
  // single-pass builder emits segments in source order. These pin both the
  // precondition and the equivalence with the scan it replaced.
  describe('against a linear scan over generated programs', () => {
    it('keeps segLine non-decreasing, the precondition for the search', () => {
      for (let seed = 1; seed <= GENERATED_PROGRAMS; seed += 1) {
        const built = model(randomProgram(seed));
        for (let index = 1; index < built.segmentCount; index += 1) {
          expect(built.segLine[index] ?? 0).toBeGreaterThanOrEqual(built.segLine[index - 1] ?? 0);
        }
      }
    });

    it('answers every line exactly as the linear scan did', () => {
      for (let seed = 1; seed <= GENERATED_PROGRAMS; seed += 1) {
        const built = model(randomProgram(seed));
        const time = buildProgramTime(built, LIMITS);
        for (let line = -1; line <= built.lineCount; line += 1) {
          expect(secondsAtLine(built, time.segTimeEndSec, line), `seed ${seed} line ${line}`).toBe(
            linearSecondsAtLine(built, time.segTimeEndSec, line),
          );
        }
      }
    });
  });
});

const GENERATED_PROGRAMS = 24;
const PROGRAM_LINES = 40;
// Numerical Recipes' LCG: seeded so a failure is reproducible from its seed.
const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_MODULUS = 0x100000000;

/** The scan secondsAtLine used before it binary-searched: first segment whose
 * source line matches, else null. */
function linearSecondsAtLine(
  built: GcodeRenderModel,
  segTimeEndSec: Float32Array,
  line: number,
): number | null {
  for (let index = 0; index < built.segmentCount; index += 1) {
    if (built.segLine[index] !== line) continue;
    return index === 0 ? 0 : (segTimeEndSec[index - 1] ?? 0);
  }
  return null;
}

// A mix of motionless lines, single-segment moves and arcs (many segments for
// one line), so the generated segLine arrays have runs, gaps and repeats.
function randomProgram(seed: number): string {
  const random = lcg(seed);
  const lines: string[] = ['G21 G90', 'M3 S400'];
  let x = 0;
  let y = 0;
  for (let index = 0; index < PROGRAM_LINES; index += 1) {
    const roll = random();
    if (roll < 0.25) {
      lines.push(roll < 0.125 ? '(setup note)' : `M3 S${Math.round(random() * 1000)}`);
      continue;
    }
    const nextX = Math.round(random() * 100);
    const nextY = Math.round(random() * 100);
    if (roll < 0.4 && (nextX !== x || nextY !== y)) {
      lines.push(`G2 X${nextX} Y${nextY} I${Math.max(1, Math.abs(nextX - x))} J0`);
    } else {
      lines.push(`${roll < 0.7 ? 'G1' : 'G0'} X${nextX} Y${nextY} F600`);
    }
    x = nextX;
    y = nextY;
  }
  return lines.join('\n');
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * LCG_MULTIPLIER + LCG_INCREMENT) >>> 0;
    return state / LCG_MODULUS;
  };
}
