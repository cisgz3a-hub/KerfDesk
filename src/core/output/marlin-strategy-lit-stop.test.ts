// Audit 2026-10-21, 03-P2-2 (ADR-398 Amendment 1): Marlin output is built as a
// GRBL M4 body and rewritten to continuous inline power (`M3 I`) or fan PWM.
// Marlin 2.1.2.5 turns the beam off at an empty planner only in its dynamic
// mode (stepper.cpp:2345-2349), and M7/M8/M9 and M5 synchronize first
// (M7-M9.cpp, M3-M5.cpp). An air change written straight after a lit burn
// therefore stopped the head with the beam on until the next block started
// (up to BLOCK_DELAY_FOR_1ST_MOVE, 100 ms). The body's transitions now wait
// for a dark move as they do under GRBL M3. The oracle is
// src/__fixtures__/controllers/marlin-lit-drain-checker.ts.

import { describe, expect, it } from 'vitest';
import { findMarlinLitPlannerDrains } from '../../__fixtures__/controllers/marlin-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CutGroup, RasterGroup } from '../job';
import { marlinStrategy } from './marlin-strategy';

const INLINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  airAssistCommand: 'M8',
  gcodeDialect: { dialectId: 'marlin-inline' },
};
const FAN: DeviceProfile = { ...INLINE, gcodeDialect: { dialectId: 'marlin-fan' } };

function line(
  id: string,
  airAssist: boolean,
  points: ReadonlyArray<[number, number]>,
  patch: Partial<CutGroup> = {},
): CutGroup {
  return {
    kind: 'cut',
    layerId: id,
    color: '#ff0000',
    power: 30,
    speed: 1200,
    passes: 1,
    airAssist,
    segments: [{ polyline: points.map(([x, y]) => ({ x, y })), closed: false }],
    ...patch,
  };
}

const A = (air: boolean): CutGroup =>
  line('A', air, [
    [0, 390],
    [10, 390],
  ]);
const B = (air: boolean): CutGroup =>
  line('B', air, [
    [40, 390],
    [60, 390],
  ]);

function image(): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000000',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array([0, 200, 200, 0]),
    pixelWidth: 4,
    pixelHeight: 1,
    bounds: { minX: 30, minY: 30, maxX: 34, maxY: 31 },
    overscanMm: 2,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
}

describe('03-P2-2: Marlin holds air changes until a dark move', () => {
  it.each([
    ['inline', INLINE],
    ['fan', FAN],
  ])('%s: air on, then off, between operations', (_label, device) => {
    const out = marlinStrategy.emit({ groups: [A(true), B(false)] }, device);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    expect(out.match(/^M[789]$/gm)).toEqual(['M8', 'M9']);
  });

  it('inline: the M9 follows the next operation’s travel', () => {
    const out = marlinStrategy.emit({ groups: [A(true), B(false)] }, INLINE);
    expect(out).toContain(
      [
        'G1 X10.000 Y390.000 F1200 S77',
        '; layer B color #ff0000 power 30% speed 1200 mm/min passes 1',
        '; pass 1 of 1',
        'G0 X40.000 Y390.000 F6000 S0',
        'M9',
        'G1 X60.000 Y390.000 F1200 S77',
      ].join('\n'),
    );
  });

  it('fan: the M9 follows the fan-off travel', () => {
    const out = marlinStrategy.emit({ groups: [A(true), B(false)] }, FAN);
    expect(out).toContain('M107\nG0 X40.000 Y390.000 F6000\nM9\nM106 S77\nG1 X60.000 Y390.000');
  });

  it.each([
    ['inline', INLINE],
    ['fan', FAN],
  ])('%s: air off, then on, on the same contour', (_label, device) => {
    const sameStart = line('B', true, [
      [10, 390],
      [30, 390],
    ]);
    const out = marlinStrategy.emit({ groups: [A(false), sameStart] }, device);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    // The travel to where the head already is plans no Marlin block, so a
    // 1 mm laser-off move along the next edge takes the drain dark.
    expect(out).toMatch(/G0 X11\.000 Y390\.000 F6000(?: S0)?\nM8\nG0 X10\.000 Y390\.000/);
  });

  it('inline: a change to constant power waits for the travel too', () => {
    const constant = { ...B(false), powerMode: 'constant' as const };
    const out = marlinStrategy.emit({ groups: [A(false), constant] }, INLINE);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('G0 X40.000 Y390.000 F6000 S0\nM5 I\nM3 I S0\nG1 X60.000');
  });

  it('inline: an image after a cut arms after its first travel', () => {
    const out = marlinStrategy.emit(
      { groups: [A(true), { ...image(), airAssist: false }] },
      INLINE,
    );
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    expect(out).toMatch(/; image layer R[^]*?\nG0 [^\n]*S0\nM9\nM5 I\nM3 I S0\nG1 /);
  });

  it.each([
    ['inline', INLINE],
    ['fan', FAN],
  ])('%s: a last air-on group that burns nothing writes no air change', (_label, device) => {
    const collapsed = line('B', true, [
      [50, 50],
      [50.0001, 50],
    ]);
    const out = marlinStrategy.emit({ groups: [A(false), collapsed] }, device);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    expect(out).not.toMatch(/^M[789]$/m);
  });
});

describe('Marlin output without a lit stop keeps its bytes', () => {
  it('a two-pass closed contour keeps the travel at the pass seam', () => {
    const square: CutGroup = {
      ...line('A', false, [
        [10, 10],
        [20, 10],
        [20, 20],
        [10, 10],
      ]),
      passes: 2,
    };
    const out = marlinStrategy.emit({ groups: [square] }, INLINE);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('; pass 2 of 2\nG0 X10.000 Y10.000 F6000 S0\nG1 X20.000 Y10.000');
  });

  it('an air change before any burn is written where it was', () => {
    const out = marlinStrategy.emit({ groups: [A(true)] }, INLINE);
    expect(out).toMatch(/^M5 I\nG21\nG90\nM3 I S0\nM8\n; layer A/);
    expect(out).toContain('S77\nM9\nM5 I\nG0 X0.000 Y0.000 F6000 S0');
  });
});

describe('the Marlin lit-drain checker', () => {
  it('reports the pre-fix inline bytes from the audit reproduction', () => {
    const before = [
      'M5 I',
      'G21',
      'G90',
      'M3 I S0',
      'M8',
      'G0 X0.000 Y390.000 F6000 S0',
      'G1 X10.000 Y390.000 F1200 S77',
      'M9',
      'G0 X40.000 Y390.000 F6000 S0',
      'G1 X60.000 Y390.000 F1200 S77',
      'M5 I',
      'G0 X0.000 Y0.000 F6000 S0',
    ].join('\n');
    expect(findMarlinLitPlannerDrains(before)).toEqual([
      'line 8 "M9" drains with the beam lit at 77',
    ]);
  });

  it('reports a fan program that changes air with the fan on', () => {
    const before = ['M107', 'M8', 'G0 X0 Y0 F6000', 'M106 S77', 'G1 X10 F1200', 'M9', 'M107'];
    expect(findMarlinLitPlannerDrains(before.join('\n'))).toEqual([]);
    const midJob = [...before.slice(0, 6), 'M107', 'G0 X40 F6000', 'M106 S77', 'G1 X60', 'M107'];
    expect(findMarlinLitPlannerDrains(midJob.join('\n'))).toEqual([
      'line 6 "M9" drains with the beam lit at 77',
    ]);
  });

  it('does not count a move to the same position as darkening', () => {
    const program = [
      'M3 I S0',
      'G0 X0 Y0 F6000 S0',
      'G1 X10 Y0 F1200 S77',
      'G0 X10 Y0 F6000 S0',
      'M8',
      'G0 X20 Y0 F6000 S0',
      'G1 X30 Y0 F1200 S77',
      'M5 I',
    ];
    expect(findMarlinLitPlannerDrains(program.join('\n'))).toEqual([
      'line 5 "M8" drains with the beam lit at 77',
    ]);
  });
});
