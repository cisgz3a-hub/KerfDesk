// ADR-273 Amendment 1: a group records a ramp entry only where it enters along
// its path. Relief roughing rings and finishing rows plunge at their starts, so
// before the amendment both relief groups carried the layer's ramp angle, and
// the G-code header said `; cnc entry: contour-ramp; max-angle-deg: 5.000`
// above a straight `G1 Z-1.500 F300` plunge. The layer's other shapes still
// ramp. Stated as the rule, the test also holds for a relief planner that
// ramps and records it (ADR-424, PR #939).

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
  const claims = lines.filter((line) => line.startsWith('; cnc entry'));
  expect(claims).toEqual(
    claims.length === 0 ? [] : ['; cnc entry: contour-ramp; max-angle-deg: 5.000'],
  );
  expect(group(job, operation).rampEntryDeg).toBe(claims.length === 0 ? undefined : 5);
  expect(firstDescent(lines)).toMatch(claims.length === 0 ? PLUNGE : ALONG_PATH);
}

describe('relief entry provenance', () => {
  it('claims a ramp on a relief group only where the group ramps', () => {
    const job = compile([flatRelief()], { reliefFinishToolId: 'bn-3175' });
    // Both relief groups claimed the ramp above a straight plunge.
    expectEntryMatchesClaim(job, 'relief-rough');
    expectEntryMatchesClaim(job, 'relief-finish');
  });

  it('keeps the layer ramp on the shapes it ramps', () => {
    const job = compile([square(), flatRelief()], { depthMm: 1, tabsEnabled: false });
    expect(group(job, 'profile-on-path').rampEntryDeg).toBe(5);
    expectEntryMatchesClaim(job, 'profile-on-path');
    expectEntryMatchesClaim(job, 'relief-rough');
  });
});
