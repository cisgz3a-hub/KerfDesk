// ADR-424 Amendment 1: relief roughing still plunges into a loop shorter than
// one cut width when a ramp angle is set (ADR-424 item 4). The pass is marked
// `entryPlunge`, so the G-code header counts it under the ramp it claims and
// Job Review lists it as an advisory, as ADR-471 does for contour ramps.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES, runCncPreflight } from '../preflight';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ReliefObject,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { rampEntryPlungesByLayer } from './contour-ramp-entry';

const COLOR = '#a0522d';
const SIZE_MM = 12;
const SAMPLES = 120;
const HOLE_MM = 6;
const DEPTH_MM = 3;

// A 12 mm relief standing at the stock top round a 6 mm square hole, 3 mm
// deep. Kept 0.5 mm off the walls, the 3.175 mm end mill's centre has a loop
// 2.7 mm round on each of the hole's two levels: shorter than its cut width.
// (Holes from 5.7 to 6.2 mm give the same loop.)
function dimpleRelief(): ReliefObject {
  const pitch = SIZE_MM / SAMPLES;
  const middle = SIZE_MM / 2;
  const samples: number[] = [];
  for (let j = 0; j < SAMPLES; j += 1) {
    for (let i = 0; i < SAMPLES; i += 1) {
      const off = Math.max(
        Math.abs((i + 0.5) * pitch - middle),
        Math.abs((j + 0.5) * pitch - middle),
      );
      samples.push(off < HOLE_MM / 2 ? 0 : 255);
    }
  }
  return {
    kind: 'relief',
    id: 'dimple',
    source: 'dimple.png',
    reliefSource: testReliefHeightfield({
      width: SAMPLES,
      height: SAMPLES,
      physicalWidthMm: SIZE_MM,
      physicalHeightMm: SIZE_MM,
      maxDepthMm: DEPTH_MM,
      samplesU8: samples,
    }),
    targetWidthMm: SIZE_MM,
    reliefDepthMm: DEPTH_MM,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: SIZE_MM, maxY: SIZE_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function sceneWith(settings: Partial<CncLayerSettings>): Scene {
  return {
    objects: [dimpleRelief()],
    layers: [
      {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, toolId: 'em-3175', depthPerPassMm: 1.5, ...settings },
      },
    ],
  };
}

function compile(scene: Scene): Job {
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

function roughing(job: Job): CncGroup {
  const found = job.groups.find(
    (group): group is CncGroup => group.kind === 'cnc' && group.cutType === 'relief-rough',
  );
  if (found === undefined) throw new Error('no relief roughing group');
  return found;
}

// The roughing group's own lines, from its layer comment to the program end.
function roughingLines(job: Job): ReadonlyArray<string> {
  const lines = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE).split('\n');
  const operation = lines.findIndex((line) => line.startsWith('; cnc operation: relief-rough;'));
  return lines.slice(operation);
}

// Straight down below the stock top at the plunge feed.
const PLUNGE = /^G1 Z-\d+\.\d{3} F300$/;

describe('relief roughing plunges under a ramp (ADR-424 Amendment 1)', () => {
  it('marks the passes it plunges, and the header counts every one', () => {
    const job = compile(sceneWith({ rampEntryDeg: 5 }));
    const passes = roughing(job).passes;
    const lines = roughingLines(job);

    expect(passes).toHaveLength(2);
    for (const pass of passes) expect(pass).toMatchObject({ kind: 'contour', entryPlunge: true });
    expect(lines.filter((line) => line.startsWith('; cnc entry'))).toEqual([
      '; cnc entry: contour-ramp; max-angle-deg: 5.000',
      '; cnc entry-advisory: 2 passes plunge: path shorter than one cut width',
    ]);
    // Neither level ramps: both enter the hole straight down, which the
    // ramp line alone used to hide.
    expect(lines.filter((line) => PLUNGE.test(line))).toHaveLength(2);
    expect(rampEntryPlungesByLayer(job)).toEqual([
      { layerId: 'L1', passes: 2, pocket: false, relief: true },
    ]);
  });

  it('marks nothing and claims nothing without a ramp angle', () => {
    const plunged = compile(sceneWith({}));
    const ramped = compile(sceneWith({ rampEntryDeg: 5 }));
    const lines = roughingLines(plunged);

    expect(roughing(plunged).passes.some((pass) => 'entryPlunge' in pass)).toBe(false);
    expect(lines.filter((line) => line.startsWith('; cnc entry'))).toEqual([]);
    // Same motion either way: the marker only discloses.
    const motion = (job: Job): ReadonlyArray<string> =>
      roughingLines(job).filter((line) => !line.startsWith(';'));
    expect(motion(ramped)).toEqual(motion(plunged));
  });

  it('names the field that sets the relief ramp, as an advisory only', () => {
    for (const [cutType, field] of [
      ['profile-on-path', 'Ramp entry'],
      // A V-carve layer's Ramp entry sets the V-bit angle; relief roughing
      // reads Roughing ramp there.
      ['v-carve', 'Roughing ramp'],
    ] as const) {
      const scene = sceneWith({ cutType, rampEntryDeg: 5 });
      const job = compile(scene);
      const issues = runCncPreflight(
        { ...createProject(), scene },
        DEFAULT_CNC_MACHINE_CONFIG,
        cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE),
        { compiledJob: job, sourceGeometryChecks: 'compiled-evidence-only' },
      ).issues.filter((issue) => issue.code === 'cnc-ramp-entry-plunge');

      expect(issues.map((issue) => issue.message)).toEqual([
        'Layer L1: 2 relief roughing passes plunge straight down instead of ramping: ' +
          'a loop shorter than one cut width is too tight to ramp round. ' +
          `Set ${field} to 0 to remove this notice.`,
      ]);
    }
    expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('cnc-ramp-entry-plunge')).toBe(false);
  });

  it("reports a layer's relief roughing apart from its other passes", () => {
    const relief = roughing(compile(sceneWith({ rampEntryDeg: 5 })));
    const mixed: Job = {
      groups: [relief, { ...relief, cutType: 'pocket' }, { ...relief, layerId: 'L2' }],
    };

    expect(rampEntryPlungesByLayer(mixed)).toEqual([
      { layerId: 'L1', passes: 2, pocket: false, relief: true },
      { layerId: 'L1', passes: 2, pocket: true, relief: false },
      { layerId: 'L2', passes: 2, pocket: false, relief: true },
    ]);
  });
});
