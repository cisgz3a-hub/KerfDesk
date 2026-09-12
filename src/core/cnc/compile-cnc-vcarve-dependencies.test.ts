import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { CncGroup, Job } from '../job';
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
import { tileJobs } from './tile-plan';
import {
  coneRemovedDepth,
  cuttingXyLength,
  emittedFeedChords,
  flatRemovedDepth,
} from './vcarve-removal.test-support';

const VBIT: CncTool = {
  id: 'v',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 6,
  tipAngleDeg: 90,
};
const CLEAR: CncTool = { id: 'clear', name: '3 mm end mill', kind: 'end-mill', diameterMm: 3 };
const MACHINE = { ...DEFAULT_CNC_MACHINE_CONFIG, tools: [VBIT, CLEAR], toolId: VBIT.id };

function square(id: string, x: number, size: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    operationIds: [id],
    source: `${id}.svg`,
    transform: IDENTITY_TRANSFORM,
    bounds: { minX: x, minY: 10, maxX: x + size, maxY: 10 + size },
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            closed: true,
            points: [
              { x, y: 10 },
              { x: x + size, y: 10 },
              { x: x + size, y: 10 + size },
              { x, y: 10 + size },
            ],
          },
        ],
      },
    ],
  };
}

function compile(clearing: boolean): Job {
  const scene: Scene = {
    objects: [square('first', 10, 4), square('second', 30, 20), square('profile', 60, 8)],
    layers: ['first', 'second', 'profile'].map((id) => ({
      ...createLayer({ id, color: '#ff0000' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: id === 'profile' ? 'profile-on-path' : 'v-carve',
        toolId: id === 'profile' ? CLEAR.id : VBIT.id,
        vCarveFlatDepthEnabled: true,
        depthMm: 1,
        depthPerPassMm: 0.5,
        ...(id === 'second' && clearing ? { vClearToolId: CLEAR.id } : {}),
      },
    })),
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, MACHINE);
}

function secondGroup(job: Job, cutType: 'v-carve' | 'pocket'): CncGroup {
  const found = job.groups.find(
    (group) => group.kind === 'cnc' && group.layerId === 'second' && group.cutType === cutType,
  );
  if (found?.kind !== 'cnc') throw new Error(`Missing second ${cutType}`);
  return found;
}

function chords(group: CncGroup) {
  return emittedFeedChords(cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE));
}

describe('compiled V-carve clearing dependencies', () => {
  it('clears before a rest-shortened finish even when its V-bit was already used', () => {
    const alone = compile(false);
    const job = compile(true);
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups.map((group) => [group.layerId, group.cutType, group.toolId])).toEqual([
      ['first', 'v-carve', VBIT.id],
      ['second', 'pocket', CLEAR.id],
      ['second', 'v-carve', VBIT.id],
      ['profile', 'profile-on-path', CLEAR.id],
    ]);
    const program = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    expect(program.split('\n').filter((line) => line === 'M0')).toHaveLength(3);
    const before = chords(secondGroup(alone, 'v-carve'));
    const finish = chords(secondGroup(job, 'v-carve'));
    const flat = chords(secondGroup(job, 'pocket'));
    expect(cuttingXyLength(finish)).toBeLessThan(cuttingXyLength(before) * 0.65);
    let clearingContribution = 0;
    for (let iy = 0; iy < 12; iy += 1)
      for (let ix = 0; ix < 12; ix += 1) {
        const point = toMachineCoords(
          { x: 30.77 + ix * 1.61, y: 10.83 + iy * 1.59 },
          DEFAULT_DEVICE_PROFILE,
        );
        const original = coneRemovedDepth(point, before, 90);
        const trimmed = coneRemovedDepth(point, finish, 90);
        const cleared = flatRemovedDepth(point, flat, CLEAR.diameterMm);
        expect(Math.max(trimmed, cleared)).toBeGreaterThanOrEqual(original - 0.003);
        clearingContribution = Math.max(clearingContribution, original - trimmed);
      }
    // This fixture actually consumes the preclear proof; a full untouched
    // V-bit route would make an ordering assertion a weaker regression.
    expect(clearingContribution).toBeGreaterThan(0.1);
  }, 60_000);

  it('retains the same dependencies when tiles regroup tools and add registration', () => {
    const result = tileJobs(
      compile(true),
      {
        tileWidthMm: 45,
        tileHeightMm: 15,
        overlapMm: 3,
        registrationHoles: true,
        registration: {
          toolId: CLEAR.id,
          holeDiameterMm: 3,
          depthMm: 1,
          depthPerPassMm: 0.5,
          feedMmPerMin: 600,
          plungeMmPerMin: 100,
          spindleRpm: 10000,
        },
      },
      { machine: MACHINE, device: DEFAULT_DEVICE_PROFILE },
    );
    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') throw new Error('Expected tiles');
    let pairedTiles = 0;
    for (const { job } of result.tiles) {
      const groups = job.groups.filter((group) => group.kind === 'cnc');
      const clear = groups.findIndex(
        (group) => group.layerId === 'second' && group.cutType === 'pocket',
      );
      const finish = groups.findIndex(
        (group) => group.layerId === 'second' && group.cutType === 'v-carve',
      );
      if (clear >= 0 && finish >= 0) {
        pairedTiles++;
        expect(clear).toBeLessThan(finish);
      }
      const profile = groups.findIndex((group) => group.cutType === 'profile-on-path');
      if (profile >= 0)
        expect(groups.slice(profile).every((group) => group.cutType === 'profile-on-path')).toBe(
          true,
        );
    }
    expect(pairedTiles).toBeGreaterThan(0);
    expect(
      result.tiles.some(({ job }) =>
        job.groups.some((group) => group.layerId === 'tile-registration'),
      ),
    ).toBe(true);
  });
});
