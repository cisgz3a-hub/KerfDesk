// ADR-273 Amendment 1: a group records a ramp entry only where it enters along
// its path. Before the amendment every relief group carried the layer's ramp
// angle, so the G-code header said `; cnc entry: contour-ramp;
// max-angle-deg: 5.000` above a straight plunge: every relief pass before
// ADR-424 made roughing ramp, and relief finishing still after it. Stated as
// the rule, the test holds either way; the layer's other shapes keep their
// ramp.

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

// Straight down at the plunge feed, or down along the path as X and Y move.
const PLUNGE = /^G1 Z-\d+\.\d{3} F300$/;
const ALONG_PATH = /^G1 ?X-?[\d.]+ ?Y-?[\d.]+ ?Z-[\d.]+/;

// A group records a ramp, and its header names one, exactly when it enters
// along its path.
function expectEntryMatchesClaim(job: Job, operation: CncGroup['cutType']): void {
  const lines = section(job, operation);
  const claims = lines.filter((line) => line.startsWith('; cnc entry:'));
  expect(claims).toEqual(
    claims.length === 0 ? [] : ['; cnc entry: contour-ramp; requested-max-angle-deg: 5.000'],
  );
  expect(group(job, operation).rampEntryDeg).toBe(claims.length === 0 ? undefined : 5);
  expect(
    group(job, operation).passes.some((pass) => pass.kind === 'path3d' && pass.entryRamp),
  ).toBe(claims.length > 0);
  expect(lines.some((line) => line.includes('tiled ramp starts below stock top'))).toBe(false);
  expect(firstDescent(lines)).toMatch(claims.length === 0 ? PLUNGE : ALONG_PATH);
}

describe('relief entry provenance', () => {
  it('claims a ramp on a relief group only where the group ramps', () => {
    const job = compile([flatRelief()], { reliefFinishToolId: 'bn-3175' });
    // Roughing ramps and says so (ADR-424); finishing plunges and must not.
    expectEntryMatchesClaim(job, 'relief-rough');
    expectEntryMatchesClaim(job, 'relief-finish');
  });

  it('keeps the layer ramp on the shapes it ramps', () => {
    const job = compile([square(), flatRelief()], { depthMm: 1, tabsEnabled: false });
    expect(group(job, 'profile-on-path').rampEntryDeg).toBe(5);
    expectEntryMatchesClaim(job, 'profile-on-path');
    expectEntryMatchesClaim(job, 'relief-rough');
  });

  it('preserves and discloses short relief-loop plunges after compilation', () => {
    const source = flatRelief();
    const small: ReliefObject = {
      ...source,
      reliefSource: testReliefHeightfield({
        width: 1,
        height: 1,
        physicalWidthMm: 3.3,
        physicalHeightMm: 3.3,
        maxDepthMm: 3,
        samplesU8: [0],
      }),
      targetWidthMm: 3.3,
      bounds: { minX: 0, minY: 0, maxX: 3.3, maxY: 3.3 },
    };
    const job = compile([small], {});
    const rough = group(job, 'relief-rough');
    expect(rough.passes.some((pass) => pass.kind === 'contour' && pass.entryPlunge)).toBe(true);
    expect(section(job, 'relief-rough').join('\n')).toContain('path shorter than one cut width');
  });
});
