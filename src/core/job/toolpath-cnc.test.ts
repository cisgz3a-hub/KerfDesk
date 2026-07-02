import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import type { CncGroup, CncPass, Job } from './job';
import { buildToolpath } from './toolpath';

const SAFE_Z_MM = 3.81;

function group(passes: ReadonlyArray<CncPass>, overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: SAFE_Z_MM,
    passes,
    ...overrides,
  };
}

function squareLoop(at: number, size: number): ReadonlyArray<{ x: number; y: number }> {
  return [
    { x: at, y: at },
    { x: at + size, y: at },
    { x: at + size, y: at + size },
    { x: at, y: at + size },
    { x: at, y: at },
  ];
}

describe('appendCncGroupSteps (via buildToolpath)', () => {
  const twoDepthPasses: CncPass[] = [
    { kind: 'contour', zMm: -1.5, polyline: squareLoop(10, 20), closed: true },
    { kind: 'contour', zMm: -3, polyline: squareLoop(10, 20), closed: true },
  ];

  it('emits travel at safe Z, then plunge, then the cut', () => {
    const toolpath = buildToolpath(
      { groups: [group(twoDepthPasses)] },
      { startPoint: { x: 0, y: 0 } },
    );
    const kinds = toolpath.steps.map((s) => s.kind);
    expect(kinds.slice(0, 3)).toEqual(['travel', 'plunge', 'cut']);
    const travel = toolpath.steps[0];
    if (travel?.kind !== 'travel') throw new Error('expected travel');
    expect(travel.z).toEqual({ from: SAFE_Z_MM, to: SAFE_Z_MM });
  });

  it('chains same-XY depth passes without a retract or travel (emitter parity)', () => {
    const toolpath = buildToolpath(
      { groups: [group(twoDepthPasses)] },
      { startPoint: { x: 0, y: 0 } },
    );
    // travel, plunge(-1.5), cut, plunge(-3), cut — no intermediate retract.
    const kinds = toolpath.steps.map((s) => s.kind);
    expect(kinds).toEqual(['travel', 'plunge', 'cut', 'plunge', 'cut']);
    const secondPlunge = toolpath.steps[3];
    if (secondPlunge?.kind !== 'plunge') throw new Error('expected plunge');
    expect(secondPlunge.fromZ).toBe(-1.5);
    expect(secondPlunge.toZ).toBe(-3);
  });

  it('retracts to safe Z before traveling to a different XY', () => {
    const passes: CncPass[] = [
      { kind: 'contour', zMm: -1, polyline: squareLoop(10, 5), closed: true },
      { kind: 'contour', zMm: -1, polyline: squareLoop(50, 5), closed: true },
    ];
    const toolpath = buildToolpath({ groups: [group(passes)] }, { startPoint: { x: 0, y: 0 } });
    const kinds = toolpath.steps.map((s) => s.kind);
    expect(kinds).toEqual(['travel', 'plunge', 'cut', 'plunge', 'travel', 'plunge', 'cut']);
    const retract = toolpath.steps[3];
    if (retract?.kind !== 'plunge') throw new Error('expected retract plunge');
    expect(retract.toZ).toBe(SAFE_Z_MM);
  });

  it('gives path3d cuts a 3D arc length and a z span', () => {
    const ramp: CncPass = {
      kind: 'path3d',
      points: [
        { x: 0, y: 0, z: -0.5 },
        { x: 3, y: 4, z: -2.5 }, // XY dist 5, dz 2 → 3D length sqrt(29)
      ],
      closed: false,
    };
    const toolpath = buildToolpath({ groups: [group([ramp])] });
    const cut = toolpath.steps.find((s) => s.kind === 'cut');
    if (cut?.kind !== 'cut') throw new Error('expected cut');
    expect(cut.length).toBeCloseTo(Math.sqrt(29), 9);
    expect(cut.z).toEqual({ from: -0.5, to: -2.5 });
  });
});

// ── Emitter agreement property ──────────────────────────────────────────────
// The simulator and the G-code emitter must describe the SAME motion: the
// ordered cut-move endpoints and the ordered plunge targets extracted from
// the emitted text equal the simulator's steps. Coordinates are generated on
// a 0.01 mm grid so emit-precision (3 dp) equality is exact.

type ParsedMoves = {
  readonly cutXy: ReadonlyArray<string>;
  readonly plungeZ: ReadonlyArray<string>;
};

function parseEmittedMoves(gcode: string): ParsedMoves {
  const cutXy: string[] = [];
  const plungeZ: string[] = [];
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!/^G1\b/.test(line)) continue;
    const x = /\bX(-?\d+(?:\.\d+)?)/.exec(line)?.[1];
    const y = /\bY(-?\d+(?:\.\d+)?)/.exec(line)?.[1];
    const z = /\bZ(-?\d+(?:\.\d+)?)/.exec(line)?.[1];
    if (x !== undefined || y !== undefined) {
      cutXy.push(`${x ?? ''},${y ?? ''}`);
    } else if (z !== undefined) {
      plungeZ.push(z);
    }
  }
  return { cutXy, plungeZ };
}

function fmt(n: number): string {
  return n.toFixed(3);
}

function simulatedMoves(job: Job): ParsedMoves {
  const toolpath = buildToolpath(job, { startPoint: { x: 0, y: 0 } });
  const cutXy: string[] = [];
  const plungeZ: string[] = [];
  for (const step of toolpath.steps) {
    if (step.kind === 'plunge') {
      if (step.toZ !== SAFE_Z_MM) plungeZ.push(fmt(step.toZ));
      continue;
    }
    if (step.kind !== 'cut') continue;
    for (let i = 1; i < step.polyline.length; i += 1) {
      const p = step.polyline[i];
      if (p === undefined) continue;
      cutXy.push(`${fmt(p.x)},${fmt(p.y)}`);
    }
  }
  return { cutXy, plungeZ };
}

describe('simulator ≡ emitter (property, 100 seeds)', () => {
  const STOCK_MM = 10;
  const gridCoord = fc.integer({ min: 0, max: 10000 }).map((n) => n / 100);
  const gridDepth = fc.integer({ min: -Math.round(STOCK_MM * 100), max: -10 }).map((n) => n / 100);

  // Distinct consecutive XY so the emitter's zero-length skip never fires —
  // the sim's polylines and the emitted moves then correspond 1:1.
  const polyline = fc
    .array(fc.record({ x: gridCoord, y: gridCoord }), { minLength: 2, maxLength: 6 })
    .filter((pts) =>
      pts.every((p, i) => i === 0 || p.x !== pts[i - 1]?.x || p.y !== pts[i - 1]?.y),
    );

  const contourPass: fc.Arbitrary<CncPass> = fc
    .record({ polyline, zMm: gridDepth })
    .map(({ polyline: pl, zMm }) => ({ kind: 'contour', zMm, polyline: pl, closed: false }));

  const path3dPass: fc.Arbitrary<CncPass> = fc
    .array(fc.record({ x: gridCoord, y: gridCoord, z: gridDepth }), { minLength: 2, maxLength: 6 })
    .filter((pts) => pts.every((p, i) => i === 0 || p.x !== pts[i - 1]?.x || p.y !== pts[i - 1]?.y))
    .map((points) => ({ kind: 'path3d', points, closed: false }));

  const cncJob: fc.Arbitrary<Job> = fc
    .array(
      fc
        .array(fc.oneof(contourPass, path3dPass), { minLength: 1, maxLength: 4 })
        .map((passes) => group(passes)),
      { minLength: 1, maxLength: 3 },
    )
    .map((groups) => ({ groups }));

  it('cut endpoints and plunge targets match the emitted G-code exactly', () => {
    fc.assert(
      fc.property(cncJob, (job) => {
        const emitted = parseEmittedMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
        const simulated = simulatedMoves(job);
        expect(simulated.cutXy).toEqual(emitted.cutXy);
        expect(simulated.plungeZ).toEqual(emitted.plungeZ);
      }),
      { numRuns: 100 },
    );
  });
});
