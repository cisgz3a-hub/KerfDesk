import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import type { CncTiling } from '../scene';
import { tileJobs } from './tile-plan';

const ORDINARY_TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: false,
};

function diagonalJob(maxMm: number): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: maxMm, y: maxMm },
        ],
      },
    ],
  };
  return { groups: [group] };
}

function onePointJob(): Job {
  const job = diagonalJob(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected CNC group');
  return {
    groups: [
      {
        ...group,
        passes: [{ kind: 'contour', zMm: -1, closed: false, polyline: [{ x: 1, y: 1 }] }],
      },
    ],
  };
}

describe('tileJobs result', () => {
  it('returns an explicit empty result when the job has no CNC motion', () => {
    expect(tileJobs({ groups: [] }, ORDINARY_TILING)).toEqual({ kind: 'empty' });
  });

  it('returns work metadata before clipping an over-budget grid', () => {
    const result = tileJobs(diagonalJob(400), {
      tileWidthMm: 60,
      tileHeightMm: 60,
      overlapMm: 100,
      registrationHoles: false,
    });

    expect(result.kind).toBe('work-budget-exceeded');
    if (result.kind !== 'work-budget-exceeded') throw new Error('expected work metadata');
    expect(result).not.toHaveProperty('tiles');
    expect(result.grid.work.exactTileCount).toBe(116_281);
  });

  it('returns empty when bounded source geometry clips to no usable motion', () => {
    expect(tileJobs(onePointJob(), ORDINARY_TILING)).toEqual({ kind: 'empty' });
  });
});
