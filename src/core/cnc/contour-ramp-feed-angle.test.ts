// ADR-472: a contour or tabbed ramp descends no faster in Z than the plunge
// rate, and no emitted move is steeper than the requested angle, wherever
// job-origin placement moves the job.

import { describe, expect, it } from 'vitest';
import { motions, xyLength, type Motion } from '../../__fixtures__/cnc-repair/motion-fixture';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { applyJobOriginOffset, type CncGroup, type Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Polyline,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

function circle(diameter: number, segments: number): Polyline {
  const points = [];
  for (let k = 0; k < segments; k += 1) {
    const t = (2 * Math.PI * k) / segments;
    points.push({ x: 40 + (diameter / 2) * Math.cos(t), y: 40 + (diameter / 2) * Math.sin(t) });
  }
  return { closed: true, points };
}

function compile(polyline: Polyline, settings: Partial<CncLayerSettings>): Job {
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'ramp.svg',
    bounds: { minX: 0, minY: 0, maxX: 80, maxY: 80 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [polyline] }],
  };
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: '#ff0000', color: '#ff0000' }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...settings },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

// Shifts that round the same geometry differently: none, a half step (a
// rounding tie) and an arbitrary one.
const OFFSETS = [
  { x: 0, y: 0 },
  { x: 100.0005, y: 50.0005 },
  { x: 37.12345, y: 81.98765 },
];

function emittedAt(job: Job, offset: { readonly x: number; readonly y: number }): string {
  return cncGrblStrategy.emit(applyJobOriginOffset(job, offset), DEFAULT_DEVICE_PROFILE);
}

// Feed moves that go down while moving across: the ramps.
function rampMoves(gcode: string): Motion[] {
  return motions(gcode).filter(
    (move) => move.mode === 1 && move.to.z < move.from.z && xyLength(move) > 0,
  );
}

// Floating-point slack on the degree conversion, far below one 0.001 mm step.
const ANGLE_SLACK_DEG = 1e-9;

function angleDeg(move: Motion): number {
  return (Math.atan2(move.from.z - move.to.z, xyLength(move)) * 180) / Math.PI;
}

// A rectangular tab wall rising from the cut at one XY.
function isTabRise(move: Motion): boolean {
  return move.mode === 1 && xyLength(move) === 0 && move.from.z < 0 && move.to.z > move.from.z;
}

function zRate(move: Motion): number {
  const drop = move.from.z - move.to.z;
  return (move.feed * drop) / Math.hypot(xyLength(move), drop);
}

function cncGroup(job: Job): CncGroup {
  const group = job.groups.find((candidate): candidate is CncGroup => candidate.kind === 'cnc');
  if (group === undefined) throw new Error('expected a CNC group');
  return group;
}

// The inside profile of a 6 mm hole with the 3.175 mm end mill rides a
// 64-move 2.825 mm circle. Planned in floating point, its 5 degree ramps came
// out at 5.43 degrees (5.53 placed on a half step). Tabs are off: the shipped
// tabs' windows would cover the whole ring and keep it at the tab top.
const HOLE = circle(6, 64);
const HOLE_CUT = {
  cutType: 'profile-inside',
  depthMm: 3,
  depthPerPassMm: 1.5,
  tabsEnabled: false,
} as const;
// A 50 mm through-cut outside profile keeps its holding tabs, so its ramps are
// the tabbed ramp; at 45 degrees one move came out at 63.4 degrees.
const TABBED_DISC = circle(50, 720);
const DISC_CUT = { cutType: 'profile-outside', depthMm: 6.35, depthPerPassMm: 1.5 } as const;

describe('ramp angle after 0.001 mm rounding (ADR-472)', () => {
  it.each([2, 5, 30, 45])('keeps every move of a %s degree hole ramp within the angle', (angle) => {
    const job = compile(HOLE, { ...HOLE_CUT, rampEntryDeg: angle });
    for (const offset of OFFSETS) {
      const moves = rampMoves(emittedAt(job, offset));
      // Both levels ramp: from the stock top, then from the level above.
      expect(moves.some((move) => move.from.z < 0)).toBe(true);
      for (const move of moves) {
        expect(angleDeg(move), move.line).toBeLessThanOrEqual(angle + ANGLE_SLACK_DEG);
      }
    }
  });

  it('keeps every move of a tabbed ramp within the angle', () => {
    const job = compile(TABBED_DISC, { ...DISC_CUT, rampEntryDeg: 45 });
    for (const offset of OFFSETS) {
      const gcode = emittedAt(job, offset);
      expect(motions(gcode).some(isTabRise)).toBe(true);
      const moves = rampMoves(gcode);
      expect(moves.length).toBeGreaterThan(0);
      for (const move of moves) {
        expect(angleDeg(move), move.line).toBeLessThanOrEqual(45 + ANGLE_SLACK_DEG);
      }
    }
  });
});

describe('ramp Z rate (ADR-472)', () => {
  it.each([
    ['hole', HOLE, HOLE_CUT],
    ['tabbed disc', TABBED_DISC, DISC_CUT],
  ] as const)('holds a 45 degree %s ramp to the plunge rate', (_name, polyline, cut) => {
    // At the cutting feed, 45 degrees descends at 707 mm/min against 300.
    const job = compile(polyline, {
      ...cut,
      feedMmPerMin: 1000,
      plungeMmPerMin: 300,
      rampEntryDeg: 45,
    });
    const gcode = emittedAt(job, OFFSETS[2]!);
    const ramps = rampMoves(gcode);
    expect(ramps.length).toBeGreaterThan(0);
    for (const move of ramps) expect(zRate(move), move.line).toBeLessThanOrEqual(300 + 1e-9);
    // The lap at depth keeps the cutting feed.
    const level = motions(gcode).filter((move) => move.to.z < 0 && move.to.z === move.from.z);
    expect(level.length).toBeGreaterThan(0);
    expect(level.every((move) => move.feed === 1000)).toBe(true);
  });
});

describe('a ramp on moves too short for whole 0.001 mm steps (ADR-472)', () => {
  // 3000 moves of 0.01 mm: none can descend one step at 5 degrees.
  const job = compile(circle(10, 3000), { cutType: 'engrave', depthMm: 1, rampEntryDeg: 5 });
  const gcode = emittedAt(job, OFFSETS[0]!);

  it('keeps ramping at the angle as planned, within the plunge rate, and says so', () => {
    const ramp = cncGroup(job).passes[0];
    expect(ramp).toMatchObject({
      kind: 'path3d',
      lateralFeed: 'z-rate-capped',
      entryAngleApproximate: true,
    });
    const moves = rampMoves(gcode);
    expect(moves.length).toBeGreaterThan(0);
    for (const move of moves) expect(zRate(move), move.line).toBeLessThanOrEqual(300 + 1e-9);
    // Never a straight plunge below the stock top in place of the ramp.
    expect(
      motions(gcode).some(
        (move) => move.mode === 1 && xyLength(move) === 0 && move.to.z < Math.min(move.from.z, 0),
      ),
    ).toBe(false);
    expect(gcode).toContain(
      '; cnc entry-advisory: 1 ramp keeps max-angle-deg before rounding: moves too short',
    );
  });

  it('adds no such advisory where whole steps hold the angle', () => {
    const hole = compile(HOLE, { ...HOLE_CUT, rampEntryDeg: 5 });
    expect(cncGroup(hole).passes.some((pass) => 'entryAngleApproximate' in pass)).toBe(false);
    expect(emittedAt(hole, OFFSETS[0]!)).not.toContain('max-angle-deg before rounding');
  });
});
