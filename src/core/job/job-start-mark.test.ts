import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job, CutGroup } from './job';
import { applyJobOrigin } from './job-origin';
import { grblStrategy } from '../output/grbl-strategy';
import { buildJobStartMarkPlan } from './job-start-mark';
import {
  executeGrblLine,
  powerUpGrbl,
} from '../../__fixtures__/controllers/grbl-laser-power-model';

const device = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1000 };
const head = { x: 100, y: 200, z: 0 };

function cut(x: number, y: number, power = 40): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L1',
    color: '#000000',
    power,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x, y },
          { x: x + 10, y },
        ],
      },
    ],
  };
}

function markFor(job: Job) {
  const gcode = grblStrategy.emit(job, device);
  const mark = buildJobStartMarkPlan(gcode, head, 10, 1000);
  expect(mark.point).toEqual(firstPoweredWireEntrance(gcode));
  return mark;
}

// Independent, deliberately restricted G21/G90 straight-line decoder. It
// uses literal wire coordinates/S words, not the production manifest helper.
function firstPoweredWireEntrance(gcode: string) {
  const state: WireState = { point: { x: 0, y: 0, z: 0 }, motion: 0, power: 0, armed: false };
  for (const raw of gcode.split('\n')) {
    const words = [...(raw.split(';')[0] ?? '').matchAll(/([A-Z])([-+]?[\d.]+)/g)];
    const next = { ...state.point };
    for (const [, letter, literal] of words) {
      oracleWord(state, next, letter ?? '', Number(literal));
    }
    if (
      state.motion === 1 &&
      state.armed &&
      state.power > 0 &&
      (next.x !== state.point.x || next.y !== state.point.y)
    )
      return state.point;
    state.point = next;
  }
  return null;
}

type WireState = {
  point: { x: number; y: number; z: number };
  motion: number;
  power: number;
  armed: boolean;
};

function oracleWord(
  state: WireState,
  next: WireState['point'],
  letter: string,
  value: number,
): void {
  if (letter === 'G') oracleMotion(state, value);
  if (letter === 'M') oracleLaser(state, value);
  if (letter === 'S') state.power = value;
  if (letter === 'X') next.x = value;
  if (letter === 'Y') next.y = value;
  if (letter === 'Z') next.z = value;
}

function oracleMotion(state: WireState, value: number): void {
  if (value === 20 || value === 91) throw new Error('Oracle scope exceeded');
  if (value === 0 || value === 1) state.motion = value;
}

function oracleLaser(state: WireState, value: number): void {
  if (value === 3 || value === 4) state.armed = true;
  if (value === 5) state.armed = false;
}

describe('actual emitted job-start mark', () => {
  it('uses the final represented wire point, rather than source doubles', () => {
    expect(markFor({ groups: [cut(10.00049, 20.00049)] }).point).toEqual({ x: 10, y: 20, z: 0 });
  });

  it('skips zero-power geometry before the first burn', () => {
    expect(markFor({ groups: [cut(10, 20, 0), cut(40, 50)] }).point).toEqual({
      x: 40,
      y: 50,
      z: 0,
    });
  });

  it('skips a first contour omitted by final output rounding', () => {
    const collapsed = {
      ...cut(10, 20),
      segments: [
        {
          closed: false,
          polyline: [
            { x: 10.0001, y: 20 },
            { x: 10.0002, y: 20 },
          ],
        },
      ],
    };
    expect(markFor({ groups: [collapsed, cut(40, 50)] }).point).toEqual({ x: 40, y: 50, z: 0 });
  });

  it('excludes blank raster rows, leading pixels and the overscan runway', () => {
    const job: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'L1',
          color: '#000000',
          power: 40,
          speed: 1000,
          passes: 1,
          airAssist: false,
          pixelWidth: 4,
          pixelHeight: 3,
          bounds: { minX: 10, minY: 20, maxX: 14, maxY: 23 },
          sValues: new Uint16Array([0, 0, 0, 0, 0, 500, 500, 0, 500, 500, 500, 500]),
          overscanMm: 3,
          dotWidthCorrectionMm: 0,
          bidirectional: true,
        },
      ],
    };
    expect(markFor(job).point).toEqual({ x: 11, y: 21.5, z: 0 });
  });

  it('does not substitute a centre alignment anchor for the actual contour start', () => {
    const rectangle: CutGroup = {
      ...cut(10, 20),
      segments: [
        {
          closed: true,
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 40 },
            { x: 10, y: 40 },
            { x: 10, y: 20 },
          ],
        },
      ],
    };
    const placed = applyJobOrigin(
      { groups: [rectangle] },
      { startFrom: 'current-position', anchor: 'center', currentPosition: head },
      device,
    );
    const mark = markFor(placed);
    expect(mark.point).toEqual({ x: 90, y: 190, z: 0 });
    expect(mark.returnPosition).toEqual(head);
  });

  it('queues constant stationary power, one controller second and M5, with dark travels', () => {
    const mark = markFor({ groups: [cut(10, 20)] });
    const model = powerUpGrbl(true);
    executeGrblLine(model, 'M5');
    executeGrblLine(model, mark.travelLine);
    expect(model.beam).toBe(0);
    const pulse = mark.pulseBatch.trim().split('\n');
    expect(pulse).toEqual(['G1 F1000 M3 S10', 'G4 P1', 'M5']);
    expect(pulse.join(' ')).not.toMatch(/[XYZ][-+]?\d/);
    executeGrblLine(model, pulse[0] ?? '');
    expect(model.beam).toBe(10);
    executeGrblLine(model, pulse[1] ?? '');
    expect(model.beam).toBe(10);
    executeGrblLine(model, pulse[2] ?? '');
    expect(model.beam).toBe(0);
    executeGrblLine(model, mark.returnLine);
    expect(model.beam).toBe(0);
    expect(model.errors).toEqual([]);
  });

  it('retains an inch-reported head during mm return without 3dp truncation', () => {
    const mark = buildJobStartMarkPlan(
      'G21\nG90\nG0 X10 Y20\nM3 S100\nG1 X20 Y20 F600\nM5\n',
      { x: 25.40508, y: -50.80508, z: 2.54 },
      2,
      600,
    );
    expect(mark.returnLine).toContain('X25.405080 Y-50.805080');
    expect(mark.point.z).toBe(2.54);
    expect(mark.travelLine).not.toContain(' Z');
  });

  it('finds an arc entry from the executable program', () => {
    const mark = buildJobStartMarkPlan(
      'G21\nG90\nG0 X10 Y20\nM3 S100\nG2 X20 Y20 I5 J0 F600\nM5\n',
      head,
      1,
      600,
    );
    expect(mark.point).toEqual({ x: 10, y: 20, z: 0 });
  });

  it.each(['G21\nG90\nM3 S0\nG1 X10 F600\nM5\n', 'G21\nG90\nM3 S10\nG4 P1\nM5\n'])(
    'refuses a program with no emitted powered motion (%s)',
    (gcode) => {
      expect(() => buildJobStartMarkPlan(gcode, head, 1, 600)).toThrow('no emitted powered motion');
    },
  );

  it('refuses unowned laser Z changes and invalid power/feed before any dispatch', () => {
    expect(() =>
      buildJobStartMarkPlan('G21\nG90\nG0 Z5 X10\nM3 S100\nG1 X20 F600\n', head, 1, 600),
    ).toThrow('changes laser Z');
    expect(() => buildJobStartMarkPlan('', head, 0, 600)).toThrow('positive capped S');
    expect(() => buildJobStartMarkPlan('', head, 1, 0)).toThrow('positive travel feed');
  });
});
