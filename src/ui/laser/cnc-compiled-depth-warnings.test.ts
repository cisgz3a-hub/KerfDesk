import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import {
  compiledVCarveLayerDepths,
  detectCompiledVCarveDepthWarnings,
} from './cnc-compiled-depth-warnings';

function jobAtDepth(depthMm: number): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'script',
        color: '#000000',
        cutType: 'v-carve',
        toolName: '15 degree V-bit',
        toolDiameterMm: 6,
        feedMmPerMin: 600,
        plungeMmPerMin: 250,
        spindleRpm: 12_000,
        spindleSpinupSec: 2,
        safeZMm: 5,
        passes: [
          {
            kind: 'path3d',
            closed: false,
            points: [
              { x: 0, y: 0, z: 0 },
              { x: 1, y: 0, z: -depthMm },
            ],
          },
        ],
      },
    ],
  };
}

describe('compiled V-carve depth warnings', () => {
  it('warns from exact pass depth when flowing geometry reaches below the stock', () => {
    const depths = compiledVCarveLayerDepths(jobAtDepth(22.787));
    const warnings = detectCompiledVCarveDepthWarnings(depths, 6.35);

    expect(depths).toEqual([{ layerId: 'script', depthMm: 22.787 }]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('actual compiled V-carve depth of 22.787 mm');
    expect(warnings[0]).toContain('16.44 mm past the bottom');
  });

  it('does not warn when stale settings are deep but compiled geometry stays inside the stock', () => {
    expect(
      detectCompiledVCarveDepthWarnings(compiledVCarveLayerDepths(jobAtDepth(0.759)), 6.35),
    ).toEqual([]);
  });
});
