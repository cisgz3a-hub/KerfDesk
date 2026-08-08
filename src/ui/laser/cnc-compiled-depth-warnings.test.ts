import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import { createProject, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import {
  compiledReliefLayerDepths,
  compiledVCarveLayerDepths,
  detectCompiledReliefDepthWarnings,
  detectCompiledVCarveDepthWarnings,
} from './cnc-compiled-depth-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

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

describe('compiled relief depth warnings', () => {
  it('aggregates the exact deepest roughing or finishing pass per layer', () => {
    const job: Job = {
      groups: [reliefGroup('relief-rough', 4), reliefGroup('relief-finish', 7.5)],
    };

    expect(compiledReliefLayerDepths(job)).toEqual([{ layerId: 'relief', depthMm: 7.5 }]);
    expect(detectCompiledReliefDepthWarnings(compiledReliefLayerDepths(job), 6.35)).toEqual([
      expect.stringContaining('actual compiled relief depth of 7.5 mm'),
    ]);
  });

  it('stays silent inside the stock and reaches the shared Save/Start warning surface', () => {
    expect(
      detectCompiledReliefDepthWarnings(
        compiledReliefLayerDepths({
          groups: [reliefGroup('relief-rough', 6.35)],
        }),
        6.35,
      ),
    ).toEqual([]);

    const base = createProject();
    const project = {
      ...base,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: 6.35 },
      },
    };
    const job: Job = { groups: [reliefGroup('relief-finish', 8)] };
    const warnings = detectMachineJobWarnings(project, null, null, {
      ok: true,
      project,
      job,
      jobOriginOffset: { x: 0, y: 0 },
      advisories: [],
    });

    expect(warnings).toContainEqual(expect.stringContaining('1.65 mm past the bottom'));
  });
});

function reliefGroup(
  cutType: 'relief-rough' | 'relief-finish',
  depthMm: number,
): Job['groups'][number] {
  return {
    kind: 'cnc',
    layerId: 'relief',
    color: '#a0522d',
    cutType,
    toolName: cutType === 'relief-rough' ? 'Flat end mill' : 'Ball nose',
    toolDiameterMm: 3.175,
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
  };
}
