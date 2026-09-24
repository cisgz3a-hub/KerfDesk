import { describe, expect, it } from 'vitest';
import { DEFAULT_PROJECT_OPTIMIZATION } from '../scene';
import type { CncGroup } from './job';
import { optimizePaths } from './optimize-paths';

function cncGroup(layerId: string, cutType: CncGroup['cutType']): CncGroup {
  return {
    kind: 'cnc',
    layerId,
    sourceObjectId: 'part',
    color: '#f00',
    cutType,
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3.81,
    passes: [],
  };
}

describe('optimizePaths on CNC jobs', () => {
  it('keeps CNC clearing before profiles when laser layer priority is reversed', () => {
    const result = optimizePaths(
      { groups: [cncGroup('pocket', 'pocket'), cncGroup('outline', 'profile-outside')] },
      { ...DEFAULT_PROJECT_OPTIMIZATION, layerPriority: 'reverse-project-order' },
    );

    expect(result.groups.map((candidate) => candidate.layerId)).toEqual(['pocket', 'outline']);
  });
});
