import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { withPassAirFloors } from './cnc-pass-air-floors';

function emit(passes: ReadonlyArray<CncPass>, mirror = 1, offset = 0): string {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'pocket',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    retractBetweenPasses: true,
    passes: withPassAirFloors(passes).map((pass) =>
      pass.kind === 'contour'
        ? {
            ...pass,
            polyline: pass.polyline.map((point) => ({ x: offset + mirror * point.x, y: point.y })),
          }
        : pass,
    ),
  };
  return cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
}

describe('air floors require an earlier emitted cut', () => {
  it.each([1, -1])(
    'does not prove collapsed source coordinates before later placement (mirror %s)',
    (mirror) => {
      const line = (x: number, zMm: number): CncPass => ({
        kind: 'contour',
        closed: false,
        zMm,
        polyline: [
          { x, y: 0 },
          { x, y: 20 },
        ],
      });
      const program = emit([line(0, -3), line(0.0000004, -6)], mirror, 10.0004998);
      expect(program).not.toContain('G0 Z-2.000');
      // The exact repeated path remains provable under the same placement.
      expect(emit([line(0, -3), line(0, -6)], mirror, 10.0004998)).toContain('G0 Z-2.000');
    },
  );

  it('does not expand a prior cut across a coordinate rounding boundary', () => {
    const line = (x: number, zMm: number): CncPass => ({
      kind: 'contour',
      closed: false,
      zMm,
      polyline: [
        { x, y: 0 },
        { x, y: 20 },
      ],
    });
    const program = emit([line(0.0004998, -3), line(0.0005002, -6)]);
    expect(program).toContain('G0 X0.000 Y0.000');
    expect(program).toContain('G0 X0.001 Y0.000');
    expect(program).not.toContain('G0 Z-2.000');
  });

  it('does not credit a raw-collinear subdivision that rounds off the earlier line', () => {
    const earlier: CncPass = {
      kind: 'contour',
      closed: false,
      zMm: -3,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0.001 },
      ],
    };
    const later: CncPass = {
      kind: 'contour',
      closed: false,
      zMm: -6,
      polyline: [
        { x: 5, y: 0.0005 },
        { x: 10, y: 0.001 },
      ],
    };
    expect(emit([earlier, later])).not.toContain('G0 Z-2.000');
  });

  it('does not claim the circle when a near-full arc emits sampled chords', () => {
    const earlier: CncPass = {
      kind: 'arc',
      start: { x: 20, y: 10 },
      end: { x: 20, y: 9.9999 },
      center: { x: 10, y: 10 },
      clockwise: false,
      zMm: -3,
      closed: false,
    };
    const point = { x: 10 + 10 * Math.cos(Math.PI / 100), y: 10 + 10 * Math.sin(Math.PI / 100) };
    const drill: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { ...point, z: -6 },
        { ...point, z: -8 },
      ],
    };
    expect(emit([earlier])).not.toMatch(/G[23] /);
    expect(emit([earlier, drill])).not.toContain('G0 Z-2.000');
  });

  it('does not rapid through stock after a stationary contour the emitter skips', () => {
    const point = { x: 10, y: 10 };
    const skipped: CncPass = {
      kind: 'contour',
      zMm: -3,
      polyline: [point, point],
      closed: false,
    };
    const drill: CncPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { ...point, z: -6 },
        { ...point, z: -8 },
      ],
    };
    expect(emit([skipped])).not.toContain('G1 Z-3.000');
    const program = emit([skipped, drill]);
    expect(program).not.toContain('G0 Z-2.000');
    expect(program).toContain('G0 X10.000 Y10.000\nG1 Z-6.000 F300');
  });

  it('does not use a helix whose descent cannot be emitted as prior stock removal', () => {
    const polyline = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ];
    const skipped: CncPass = {
      kind: 'helical-contour',
      start: { x: 10, y: 10 },
      center: { x: 10, y: 10 },
      clockwise: true,
      startZMm: -3,
      zMm: -4,
      revolutions: 2,
      polyline,
      closed: true,
    };
    const next: CncPass = { kind: 'contour', zMm: -6, polyline, closed: true };
    expect(emit([skipped])).not.toMatch(/G[123] /);
    expect(emit([skipped, next])).not.toContain('G0 Z-2.000');
  });
});
