import { describe, expect, it } from 'vitest';
import { buildProgramTime } from '../gcode-time';
import { buildGcodeRenderModel } from './gcode-render-model';
import { SEG_MOTION, type GcodeRenderModel } from './render-model-types';

function model(lines: ReadonlyArray<string>): GcodeRenderModel {
  const result = buildGcodeRenderModel(lines.join('\n'));
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function lineMoves(built: GcodeRenderModel, line: number) {
  return [...built.segLine].flatMap((sourceLine, index) =>
    sourceLine === line
      ? [
          {
            from: [...built.positions.slice(index * 6, index * 6 + 3)].map(round),
            to: [...built.positions.slice(index * 6 + 3, index * 6 + 6)].map(round),
            motion: built.segMotion[index],
          },
        ]
      : [],
  );
}

function round(value: number): number {
  return Number(value.toFixed(4));
}

describe('canned-cycle modal motion', () => {
  it.each(['G0 X20', 'G1 X20', 'G2 X20 I5 J0', 'G3 X20 I5 J0'])(
    '%s cancels drilling before moving',
    (motion) => {
      const built = model(['G0 Z5', 'G81 X10 Y10 Z-3 R1 F200', motion]);
      const moves = lineMoves(built, 2);
      expect(moves.length).toBeGreaterThan(0);
      expect(moves.every((move) => move.from[2] === 5 && move.to[2] === 5)).toBe(true);
      expect(moves.at(-1)?.to).toEqual([20, 10, 5]);
    },
  );

  it('captures a new initial plane after ordinary motion cancels a cycle', () => {
    const built = model(['G0 Z5', 'G99 G81 X10 Z-3 R1 F200', 'G0 Z7', 'G98 G81 X20 Z-2 R1']);
    expect(lineMoves(built, 3).at(-1)?.to).toEqual([20, 0, 7]);
  });

  it('resolves incremental R from the initial Z and depth from R, retaining sticky values', () => {
    // LinuxCNC G81 example: initial Z3 + R1.8 = R4.8; R4.8 + Z-0.6 = depth4.2.
    const built = model(['G0 Z3', 'G91 G99 G81 X4 Y5 R1.8 Z-0.6 F200', 'X4']);
    expect(lineMoves(built, 1)).toEqual([
      { from: [0, 0, 3], to: [0, 0, 4.8], motion: SEG_MOTION.rapid },
      { from: [0, 0, 4.8], to: [4, 5, 4.8], motion: SEG_MOTION.rapid },
      { from: [4, 5, 4.8], to: [4, 5, 4.2], motion: SEG_MOTION.linear },
      { from: [4, 5, 4.2], to: [4, 5, 4.8], motion: SEG_MOTION.rapid },
    ]);
    expect(lineMoves(built, 2)).toEqual([
      { from: [4, 5, 4.8], to: [8, 5, 4.8], motion: SEG_MOTION.rapid },
      { from: [8, 5, 4.8], to: [8, 5, 4.2], motion: SEG_MOTION.linear },
      { from: [8, 5, 4.2], to: [8, 5, 4.8], motion: SEG_MOTION.rapid },
    ]);
  });

  it('traverses between G99 holes at the current R plane without a phantom lift', () => {
    const built = model(['G0 Z5', 'G99 G81 X10 Y10 Z-3 R1 F200', 'X30']);
    expect(lineMoves(built, 2)).toEqual([
      { from: [10, 10, 1], to: [30, 10, 1], motion: SEG_MOTION.rapid },
      { from: [30, 10, 1], to: [30, 10, -3], motion: SEG_MOTION.linear },
      { from: [30, 10, -3], to: [30, 10, 1], motion: SEG_MOTION.rapid },
    ]);
  });

  it('uses R for G98 when the initial plane is below R', () => {
    const built = model(['G0 Z1', 'G98 G81 X10 Z-3 R4 F200']);
    expect(lineMoves(built, 1).at(-1)?.to).toEqual([10, 0, 4]);
  });

  it('keeps the initial plane when switching between contiguous cycle modes', () => {
    const built = model(['G0 Z5', 'G99 G81 X10 Z-3 R1 F200', 'G98 G83 X20 Z-4 R1 Q2']);
    expect(lineMoves(built, 2).at(-1)?.to).toEqual([20, 0, 5]);
  });

  it('retains G82 dwell on each hole and includes it in the Inspector estimate', () => {
    const built = model(['G0 Z5', 'G82 X10 Z-3 R1 P2 F200', 'X30', 'G80', 'G4 P0.5']);
    expect(built.events.filter((event) => event.kind === 'dwell')).toEqual([
      { kind: 'dwell', line: 1, seconds: 2 },
      { kind: 'dwell', line: 2, seconds: 2 },
      { kind: 'dwell', line: 4, seconds: 0.5 },
    ]);
    const time = buildProgramTime(built, {
      accelMmPerSec2: 100,
      junctionDeviationMm: 0.01,
      maxFeedMmPerMin: 3000,
    });
    expect(time.dwellSeconds).toBe(4.5);
    expect(time.totalSeconds - time.motionSeconds).toBeCloseTo(4.5);
  });
});
