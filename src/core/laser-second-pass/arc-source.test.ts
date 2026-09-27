// ADR-432: laser output on arc-capable GRBL profiles carries G2/G3. The
// painted second pass reads each arc as the chords mc_arc runs for it, so the
// darkening offer made for those controllers still builds a pass.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords, type DeviceProfile } from '../devices';
import { compileJob } from '../job/compile-job';
import { grblStrategy } from '../output/grbl-strategy';
import { createLayer, IDENTITY_TRANSFORM, type CurveSubpath, type ImportedSvg } from '../scene';
import { buildLaserSecondPassProgram, parseLaserSecondPassSource } from './index';
import { simulateProgram } from './program-oracle.test-helper';
import { laserSecondPassSupportsController } from './source-family';
import type { LaserSecondPassSelection } from './types';

const ARC_DEVICE: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' };
const KAPPA = (4 / 3) * Math.tan(Math.PI / 8);
const CENTER = { x: 50, y: 40 };
const RADIUS = 10;
const MACHINE_CENTER = toMachineCoords(CENTER, ARC_DEVICE);

function circle(): CurveSubpath {
  const { x: cx, y: cy } = CENTER;
  const r = RADIUS;
  const k = KAPPA * r;
  return {
    start: { x: cx + r, y: cy },
    closed: true,
    segments: [
      {
        kind: 'cubic',
        control1: { x: cx + r, y: cy + k },
        control2: { x: cx + k, y: cy + r },
        to: { x: cx, y: cy + r },
      },
      {
        kind: 'cubic',
        control1: { x: cx - k, y: cy + r },
        control2: { x: cx - r, y: cy + k },
        to: { x: cx - r, y: cy },
      },
      {
        kind: 'cubic',
        control1: { x: cx - r, y: cy - k },
        control2: { x: cx - k, y: cy - r },
        to: { x: cx, y: cy - r },
      },
      {
        kind: 'cubic',
        control1: { x: cx + k, y: cy - r },
        control2: { x: cx + r, y: cy - k },
        to: { x: cx + r, y: cy },
      },
    ],
  };
}

function circleProgram(device: DeviceProfile): string {
  const svg: ImportedSvg = {
    kind: 'imported-svg',
    id: 'svg',
    source: 'circle.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [{ points: [circle().start], closed: true }],
        curves: [circle()],
      },
    ],
  };
  const job = compileJob(
    { objects: [svg], layers: [createLayer({ id: 'l', color: '#000000' })] },
    device,
  );
  return grblStrategy.emit(job, device);
}

const PAINT_ALL: LaserSecondPassSelection = {
  version: 1,
  maxPowerS: 1000,
  strokes: [{ id: 'all', mode: 'paint', radiusMm: 30, powerScale: 1, points: [MACHINE_CENTER] }],
};

describe('painted second pass over an arc program (ADR-432)', () => {
  it('builds a pass from the G2/G3 program a GRBL arc profile writes', () => {
    expect(laserSecondPassSupportsController(ARC_DEVICE.controllerKind)).toBe(true);
    const gcode = circleProgram(ARC_DEVICE);
    expect(gcode).toMatch(/^G[23] /m);
    for (const writerVersion of [1, 2] as const) {
      const result = buildLaserSecondPassProgram(gcode, PAINT_ALL, { writerVersion });
      if (result.kind !== 'ready') throw new Error(result.message);
      expect(result.burnLengthMm).toBeCloseTo(2 * Math.PI * RADIUS, 1);
      for (const motion of simulateProgram(result.gcode).filter((move) => move.power > 0)) {
        for (const point of [motion.from, motion.to]) {
          const off = Math.abs(
            Math.hypot(point.x - MACHINE_CENTER.x, point.y - MACHINE_CENTER.y) - RADIUS,
          );
          expect(off).toBeLessThan(0.025);
        }
      }
      // It burns what the G1 program would, within the machine curve tolerance.
      const g1 = buildLaserSecondPassProgram(
        circleProgram({ ...ARC_DEVICE, laserArcMoves: 'off' }),
        PAINT_ALL,
        { writerVersion },
      );
      if (g1.kind !== 'ready') throw new Error(g1.message);
      expect(Math.abs(result.burnLengthMm - g1.burnLengthMm)).toBeLessThan(0.05);
      for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
        expect(Math.abs(result.bounds[key] - g1.bounds[key])).toBeLessThan(0.025);
      }
    }
  });

  it('reads an arc as the chords mc_arc runs at the stock $12', () => {
    const source = 'G21\nG90\nG17\nM4 S0\nG0 X10 Y0 S0\nG3 X0 Y10 I-10 J0 F600 S500\nM5\n';
    const parsed = parseLaserSecondPassSource(source);
    if (parsed.kind !== 'ready') throw new Error(parsed.message);
    const burns = parsed.segments.filter((segment) => segment.power > 0);
    // floor(0.5 x (pi/2) x 10 / sqrt(0.002 x (20 - 0.002))) = 39 chords.
    expect(burns).toHaveLength(39);
    expect(burns.at(-1)?.to).toEqual({ x: 0, y: 10 });
    for (const burn of burns) {
      expect(Math.hypot(burn.to.x, burn.to.y)).toBeCloseTo(10, 9);
      expect(burn.power).toBe(500);
    }
  });
});
