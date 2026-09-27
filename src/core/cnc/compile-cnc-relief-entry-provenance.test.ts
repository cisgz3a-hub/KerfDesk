// ADR-273 Amendment 1: relief roughing rings and finishing rows plunge at
// their starts, so a relief group must not record the layer's ramp angle as
// its entry. Before the amendment both relief groups carried it, and the
// G-code header said `; cnc entry: contour-ramp; max-angle-deg: 5.000` above a
// straight `G1 Z-1.500 F300` plunge. The layer's other shapes still ramp.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type ReliefObject,
  type SceneObject,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#a0522d';

// A 20 mm relief with a flat floor 3 mm down: two 1.5 mm roughing levels.
function flatRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief',
    source: 'floor.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 3,
      samplesU8: [0],
    }),
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
}

function square(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'square',
    source: 'square.svg',
    bounds: { minX: 40, minY: 40, maxX: 60, maxY: 60 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 40, y: 40 },
              { x: 60, y: 40 },
              { x: 60, y: 60 },
              { x: 40, y: 60 },
            ],
          },
        ],
      },
    ],
  };
}

function compile(objects: ReadonlyArray<SceneObject>, settings: Partial<CncLayerSettings>): Job {
  return compileCncJob(
    {
      objects: [...objects],
      layers: [
        {
          ...createLayer({ id: 'L1', color: COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1.5, rampEntryDeg: 5, ...settings },
        },
      ],
    },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
}

function group(job: Job, cutType: CncGroup['cutType']): CncGroup {
  const found = job.groups.find(
    (candidate): candidate is CncGroup => candidate.kind === 'cnc' && candidate.cutType === cutType,
  );
  if (found === undefined) throw new Error(`no ${cutType} group`);
  return found;
}

// Each group's lines, from its `; cnc layer-id` comment to the next group's.
function sections(job: Job): ReadonlyMap<string, ReadonlyArray<string>> {
  const bySection = new Map<string, string[]>();
  let current: string[] = [];
  for (const line of cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE).split('\n')) {
    if (line.startsWith('; cnc layer-id')) current = [];
    current.push(line);
    const operation = /^; cnc operation: ([a-z-]+);/.exec(line)?.[1];
    if (operation !== undefined) bySection.set(operation, current);
  }
  return bySection;
}

function section(job: Job, operation: string): ReadonlyArray<string> {
  const lines = sections(job).get(operation);
  if (lines === undefined) throw new Error(`no ${operation} section`);
  return lines;
}

// The move that takes the cutter below the stock top for the first time.
function firstDescent(lines: ReadonlyArray<string>): string | undefined {
  return lines.find((line) => /^G1[ XYZ].*Z-/.test(line));
}

describe('relief entry provenance', () => {
  it('records no ramp on relief groups, whose passes plunge', () => {
    const job = compile([flatRelief()], { reliefFinishToolId: 'bn-3175' });
    const rough = group(job, 'relief-rough');
    const finish = group(job, 'relief-finish');
    expect(rough.rampEntryDeg).toBeUndefined();
    expect(finish.rampEntryDeg).toBeUndefined();
    // Nothing ramps them: roughing rings stay flat contour passes.
    expect(rough.passes.every((pass) => pass.kind === 'contour')).toBe(true);

    for (const operation of ['relief-rough', 'relief-finish']) {
      const lines = section(job, operation);
      expect(lines.filter((line) => line.startsWith('; cnc entry'))).toEqual([]);
      // A straight plunge at the plunge feed, not a descent along the path.
      expect(firstDescent(lines)).toMatch(/^G1 Z-\d+\.\d{3} F300$/);
    }
  });

  it('keeps the layer ramp on the shapes it ramps', () => {
    const job = compile([square(), flatRelief()], { depthMm: 1, tabsEnabled: false });
    const profile = group(job, 'profile-on-path');
    expect(profile.rampEntryDeg).toBe(5);
    const profileLines = section(job, 'profile-on-path');
    expect(profileLines).toContain('; cnc entry: contour-ramp; max-angle-deg: 5.000');
    // The profile descends along its path: X and Y move with Z.
    expect(firstDescent(profileLines)).toMatch(/^G1 X-?[\d.]+ Y-?[\d.]+ Z-[\d.]+ F1000$/);

    expect(group(job, 'relief-rough').rampEntryDeg).toBeUndefined();
    const reliefLines = section(job, 'relief-rough');
    expect(reliefLines.filter((line) => line.startsWith('; cnc entry'))).toEqual([]);
    expect(firstDescent(reliefLines)).toBe('G1 Z-1.500 F300');
  });
});
