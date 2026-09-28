// ADR-471 with ADR-457 stage recipes and ADR-368 narrowed cutter widths.
// These compile actual profiles so losing the finishing wrapper, its settings,
// or the ramp's fourth width argument cannot pass as a helper-only merge.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Vec3 } from '../geometry/vec3';
import type { CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const END_MILL: CncTool = {
  id: 'ramp-stage-bit',
  name: '3 mm end mill',
  kind: 'end-mill',
  diameterMm: 3,
  fluteCount: 2,
};

type ProfileFixture = {
  readonly sizeMm: number;
  readonly allowanceMm: number;
  readonly tool?: CncTool;
  readonly depthMm?: number;
  readonly passMm?: number;
  readonly finishPassMm?: number;
  readonly angleDeg?: number;
};

function compileProfile(fixture: ProfileFixture) {
  const tool = fixture.tool ?? END_MILL;
  const size = fixture.sizeMm;
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'short-profile',
    source: 'short-profile.svg',
    bounds: { minX: 20, minY: 20, maxX: 20 + size, maxY: 20 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 20, y: 20 },
              { x: 20 + size, y: 20 },
              { x: 20 + size, y: 20 + size },
              { x: 20, y: 20 + size },
            ],
          },
        ],
      },
    ],
  };
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: 'cut', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          toolId: tool.id,
          cutType: 'profile-inside',
          tabsEnabled: false,
          profileLead: { shape: 'none' },
          depthMm: fixture.depthMm ?? 2,
          depthPerPassMm: fixture.passMm ?? 1,
          rampEntryDeg: fixture.angleDeg ?? 1,
          finishAllowanceMm: fixture.allowanceMm,
          feedMmPerMin: 900,
          plungeMmPerMin: 200,
          spindleRpm: 12000,
          stageRecipes: {
            'profile-finish': {
              toolId: tool.id,
              feedMmPerMin: 321,
              plungeMmPerMin: 123,
              spindleRpm: 9000,
              depthPerPassMm: fixture.finishPassMm ?? 0.5,
            },
          },
        },
      },
    ],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    toolId: tool.id,
    tools: [tool],
    params: { ...DEFAULT_CNC_MACHINE_CONFIG.params, spindleSpinupSec: 0 },
  });
  return { job, groups: job.groups.filter((group) => group.kind === 'cnc') };
}

function pathPoints(pass: CncPass | undefined): ReadonlyArray<Vec3> {
  if (pass?.kind !== 'path3d') throw new Error('Expected a compiled ramp path');
  return pass.points;
}

function xyLength(points: ReadonlyArray<Vec3>): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

function expectFullRampLap(pass: CncPass, fromZ: number, zMm: number, perimeterMm: number): void {
  const points = pathPoints(pass);
  const atDepth = points.findIndex((point) => point.z === zMm);
  expect(points[0]?.z).toBeCloseTo(fromZ, 9);
  expect(atDepth).toBeGreaterThan(0);
  // The independent fixture is a 1-degree descent, longer than either square.
  const tangent = Math.tan(Math.PI / 180);
  const expectedRampMm = (fromZ - zMm) / tangent;
  expect(expectedRampMm).toBeGreaterThan(perimeterMm);
  const actualRampMm = xyLength(points.slice(0, atDepth + 1));
  expect(actualRampMm).toBeGreaterThanOrEqual(expectedRampMm);
  expect(actualRampMm - expectedRampMm).toBeLessThanOrEqual(
    atDepth * (0.001 / tangent + Math.SQRT2 * 0.001),
  );
  expect(pass).toMatchObject({ entryRamp: true, lateralFeed: 'z-rate-capped' });
  expect(xyLength(points.slice(atDepth))).toBeCloseTo(perimeterMm, 7);
  expect(points.slice(atDepth).every((point) => point.z === zMm)).toBe(true);
  expect(points.at(-1)).toEqual(points[atDepth]);
}

describe('compiled short contour ramps with independent finishing recipes', () => {
  it('laps both depth ladders and keeps the finishing feed, plunge and spindle', () => {
    const { job, groups } = compileProfile({ sizeMm: 6, allowanceMm: 0.25 });
    expect(groups.map((group) => group.passes.length)).toEqual([2, 4]);
    expect(groups.map((group) => group.feedMmPerMin)).toEqual([900, 321]);
    expect(groups.map((group) => group.plungeMmPerMin)).toEqual([200, 123]);
    expect(groups.map((group) => group.spindleRpm)).toEqual([12000, 9000]);
    expect(groups[1]).toMatchObject({ cuttingStage: 'profile-finish', depthPerPassMm: 0.5 });
    // Inside square centerlines: 6 - 3 - 2*0.25 = 2.5 mm rough, 3 mm finish.
    groups[0]!.passes.forEach((pass, i) => expectFullRampLap(pass, -i, -i - 1, 10));
    groups[1]!.passes.forEach((pass, i) => expectFullRampLap(pass, -i / 2, -(i + 1) / 2, 12));
    expect(JSON.stringify(job)).not.toContain('profileFinishStage');
    const output = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(output.match(/^M3 S\d+/gm)).toEqual(['M3 S12000', 'M3 S9000']);
    expect(output).toContain('F321');
    expect(output).toContain('F123');
    expect(output).not.toContain('path shorter than one cut width');
  });

  it('retains finishing provenance and emitted disclosure for sub-width plunges', () => {
    const { job, groups } = compileProfile({ sizeMm: 3.5, allowanceMm: 0.05 });
    expect(groups.map((group) => group.passes.length)).toEqual([2, 4]);
    expect(groups[1]).toMatchObject({
      cuttingStage: 'profile-finish',
      feedMmPerMin: 321,
      plungeMmPerMin: 123,
      spindleRpm: 9000,
    });
    // Centerline perimeters 1.6 and 2 mm are both below the 3 mm cut width.
    for (const group of groups) {
      for (const pass of group.passes)
        expect(pass).toMatchObject({ kind: 'contour', entryPlunge: true });
    }
    const output = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(output).toContain(
      '; cnc entry-advisory: 2 passes plunge: path shorter than one cut width',
    );
    expect(output).toContain(
      '; cnc entry-advisory: 4 passes plunge: path shorter than one cut width',
    );
    expect(output.match(/^M3 S\d+/gm)).toEqual(['M3 S12000', 'M3 S9000']);
  });

  it('uses the V-bit width at depth for real wall layout and the ramp threshold', () => {
    const vBit: CncTool = { ...END_MILL, kind: 'v-bit', diameterMm: 6, tipAngleDeg: 60 };
    const { groups } = compileProfile({
      sizeMm: 1,
      allowanceMm: 0.05,
      tool: vBit,
      depthMm: 0.1,
      passMm: 0.1,
      finishPassMm: 0.05,
      angleDeg: 0.5,
    });
    expect(groups.map((group) => group.passes.length)).toEqual([1, 2]);
    expect(groups[1]).toMatchObject({ cuttingStage: 'profile-finish', feedMmPerMin: 321 });
    const cutWidthMm = 2 * 0.1 * Math.tan(Math.PI / 6);
    // Both loop perimeters are below the stored 6 mm diameter but above the
    // actual 0.11547 mm cutting width; using the diameter would plunge them.
    for (const group of groups) {
      for (const pass of group.passes) expect(pass.kind).toBe('path3d');
    }
    const finish = pathPoints(groups[1]?.passes[0]);
    const xs = finish.map((point) => point.x);
    // Offset geometry lies on the existing 0.001 mm clipping grid.
    expect(Math.abs(Math.min(...xs) - (20 + cutWidthMm / 2))).toBeLessThanOrEqual(0.001);
    expect(Math.abs(Math.max(...xs) - (21 - cutWidthMm / 2))).toBeLessThanOrEqual(0.001);
    expect(groups[1]?.passes.map((pass) => pathPoints(pass)[0]?.z)).toEqual([0, -0.05]);
  });
});
