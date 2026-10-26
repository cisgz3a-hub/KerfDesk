// Audit 2026-10-21, 03-P2-1 (ADR-398 Amendment 1): under constant power (M3),
// a last group that switches air on but burns nothing used to have its held
// `M8` written straight after the final lit burn. That drains the planner with
// the beam lit, and grblHAL (`$673`) or FluidNC (`coolant/delay_ms`) then
// dwells for the air on-delay with the head stopped (grblHAL
// coolant_control.c: coolant_set_state_synced synchronizes, then delays).
// Held air changes are now dropped at the job end; the job's own M9/M5 stay.
// The oracle is src/__fixtures__/controllers/grbl-lit-drain-checker.ts, which
// now also checks the lines after the last burn.

import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CutGroup, RasterGroup } from '../job';
import { grblStrategy } from './grbl-strategy';

const COMPATIBLE_AIR: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  airAssistCommand: 'M8',
  gcodeDialect: { dialectId: 'grbl-compatible' },
};

function line(id: string, airAssist: boolean, points: ReadonlyArray<[number, number]>): CutGroup {
  return {
    kind: 'cut',
    layerId: id,
    color: '#ff0000',
    power: 30,
    speed: 1200,
    passes: 1,
    airAssist,
    segments: [{ polyline: points.map(([x, y]) => ({ x, y })), closed: false }],
  };
}

const BURN = line('A', false, [
  [0, 390],
  [10, 390],
]);
// Rounds away at three decimals, so the group writes no motion at all.
const COLLAPSED = (airAssist: boolean): CutGroup =>
  line('B', airAssist, [
    [50, 50],
    [50.0001, 50],
  ]);

function blankImage(airAssist: boolean): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000000',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist,
    sValues: new Uint16Array([0, 0, 0, 0]),
    pixelWidth: 4,
    pixelHeight: 1,
    bounds: { minX: 30, minY: 30, maxX: 34, maxY: 31 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
}

function ending(gcode: string): string {
  return gcode.slice(gcode.indexOf('G1 X10.000 Y390.000'));
}

describe('03-P2-1: no held air change drains after the last M3 burn', () => {
  it('drops the air-on of a last group whose geometry rounds away', () => {
    const out = grblStrategy.emit({ groups: [BURN, COLLAPSED(true)] }, COMPATIBLE_AIR);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).not.toMatch(/^M[789]$/m);
    expect(ending(out)).toBe(
      [
        'G1 X10.000 Y390.000 F1200 S300',
        '; layer B color #ff0000 power 30% speed 1200 mm/min passes 1',
        '; pass 1 of 1',
        'M5',
        'G0 X0.000 Y0.000 S0',
        '',
      ].join('\n'),
    );
  });

  it('drops the air-on of a last all-white image, keeping its M5 ending', () => {
    const out = grblStrategy.emit({ groups: [BURN, blankImage(true)] }, COMPATIBLE_AIR);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).not.toMatch(/^M[789]$/m);
    // The image's held opening and closing are spindle words only, led by M5.
    expect(out).toMatch(/S300\n(?:;[^\n]*\n)+M5\nM3 S0\nM5\nG0 X0\.000 Y0\.000 S0\n$/);
  });

  it('keeps the job’s own M9 when the dropped change was an air-off', () => {
    const lit = line('A', true, [
      [0, 390],
      [10, 390],
    ]);
    const out = grblStrategy.emit({ groups: [lit, COLLAPSED(false)] }, COMPATIBLE_AIR);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out.match(/^M[789]$/gm)).toEqual(['M8', 'M9']);
    expect(out).toMatch(/S300\n(?:;[^\n]*\n)+M9\nM5\nG0 X0\.000 Y0\.000 S0\n$/);
  });

  it('keeps a mode change for a last blank group, which opens with M5', () => {
    const dynamic: CutGroup = { ...COLLAPSED(false), powerMode: 'dynamic' };
    const out = grblStrategy.emit({ groups: [BURN, dynamic] }, COMPATIBLE_AIR);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toMatch(/S300\n(?:;[^\n]*\n)+M5\nM4 S0\nM5\nG0 X0\.000 Y0\.000 S0\n$/);
  });

  it('leaves a job that burns in its last air-on group unchanged', () => {
    const lastLit = line('B', true, [
      [40, 390],
      [60, 390],
    ]);
    const out = grblStrategy.emit({ groups: [BURN, lastLit] }, COMPATIBLE_AIR);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('G0 X40.000 Y390.000 S0\nM8\nG1 X60.000 Y390.000 F1200 S300\nM9\nM5\n');
  });
});

describe('the GRBL lit-drain checker now reads past the last burn', () => {
  const program = (tail: ReadonlyArray<string>): string =>
    ['G21', 'G90', 'M3 S0', 'G0 X0 Y0 S0', 'G1 X10 Y0 F1000 S300', ...tail, ''].join('\n');

  it('reports the pre-fix ending: an air-on after the last lit burn', () => {
    expect(findM3LitPlannerDrains(program(['M8', 'M9', 'M5']))).toEqual([
      'line 6 "M8" drains with M3 S300 lit',
    ]);
  });

  it('allows the job’s own M9 and M5 after the last burn', () => {
    expect(findM3LitPlannerDrains(program(['M9', 'M5', 'G0 X0 Y0 S0']))).toEqual([]);
    expect(findM3LitPlannerDrains(program(['M5', 'M9', 'G0 X0 Y0 S0']))).toEqual([]);
  });

  it('reports a re-arm or a dwell after the last lit burn', () => {
    expect(findM3LitPlannerDrains(program(['M4 S0', 'M5']))).toHaveLength(1);
    expect(findM3LitPlannerDrains(program(['G4 P1', 'M5']))).toHaveLength(1);
  });
});
