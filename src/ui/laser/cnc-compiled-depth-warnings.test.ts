import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import { parseGrblCncCoordinate } from '../../core/cnc/coordinate-representation';
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

    expect(depths).toEqual([
      { layerId: 'script', depthMm: parseGrblCncCoordinate('22.787'), depthText: '22.787' },
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('actual compiled V-carve depth of 22.787 mm');
    expect(warnings[0]).toContain('16.44 mm past the bottom');
  });

  it('does not warn when stale settings are deep but compiled geometry stays inside the stock', () => {
    expect(
      detectCompiledVCarveDepthWarnings(compiledVCarveLayerDepths(jobAtDepth(0.759)), 6.35),
    ).toEqual([]);
  });

  it('reports the represented emitted maximum rather than a deeper raw-precision fiction', () => {
    expect(compiledVCarveLayerDepths(jobAtDepth(0.0506))).toEqual([
      { layerId: 'script', depthMm: parseGrblCncCoordinate('0.051'), depthText: '0.051' },
    ]);
  });

  it('classifies stock thresholds by emitted coordinate text, not binary float drift', () => {
    const exact = compiledVCarveLayerDepths(jobAtDepth(3.798));

    // CNC audit v2 J1-P2-1: V-carve warns at the stock bottom as relief does.
    expect(detectCompiledVCarveDepthWarnings(exact, 3.798)).toEqual([
      expect.stringContaining('reaches the configured stock bottom'),
    ]);
    expect(
      detectCompiledReliefDepthWarnings(
        exact.map((entry) => ({ ...entry })),
        3.798,
      ),
    ).toEqual([expect.stringContaining('reaches the configured stock bottom')]);
  });

  it('retains an overrun whose emitted text would change after a second float format', () => {
    const depths = compiledVCarveLayerDepths(jobAtDepth(6553.606));

    expect(depths).toEqual([
      {
        layerId: 'script',
        depthMm: parseGrblCncCoordinate('6553.606'),
        depthText: '6553.606',
      },
    ]);
    expect(detectCompiledVCarveDepthWarnings(depths, 6553.605)).toEqual([
      expect.stringContaining('actual compiled V-carve depth of 6553.606 mm'),
    ]);
  });

  it('does not turn two coordinate words with one GRBL value into an overrun', () => {
    const stockThicknessMm = 9999.01;
    const controllerDepthMm = parseGrblCncCoordinate('9999.011');
    expect(controllerDepthMm).toBe(parseGrblCncCoordinate('9999.010'));
    const depths = [{ layerId: 'script', depthMm: controllerDepthMm, depthText: '9999.011' }];

    for (const detect of [detectCompiledVCarveDepthWarnings, detectCompiledReliefDepthWarnings])
      expect(detect(depths, stockThicknessMm)).toEqual([
        expect.stringContaining('reaches the configured stock bottom'),
      ]);
  });
});

describe('a floor left thinner than 0.2 mm warns like the stock bottom (CNC v3 N2-P2-3)', () => {
  const depth = (mm: number) => [{ layerId: 'relief', depthMm: mm, depthText: mm.toFixed(3) }];

  it.each([
    [6.349, '0.001'],
    [6.3, '0.05'],
    [6.2, '0.15'],
  ])('relief at %s mm in 6.35 mm stock leaves only %s mm and warns', (mm, left) => {
    expect(detectCompiledReliefDepthWarnings(depth(mm), 6.35)).toEqual([
      expect.stringContaining(`leaves only ${left} mm of stock under its floor`),
    ]);
    expect(detectCompiledReliefDepthWarnings(depth(mm), 6.35)[0]).toContain(
      'Relief paths have no holding tabs',
    );
  });

  it('a 0.2 mm floor or thicker stays quiet', () => {
    expect(detectCompiledReliefDepthWarnings(depth(6.15), 6.35)).toEqual([]);
    expect(detectCompiledReliefDepthWarnings(depth(5.8), 6.35)).toEqual([]);
  });

  it('a V-carve leaving 0.15 mm (the 1/2" 90° bit in 6.5 mm stock) warns too (J1-P2-1)', () => {
    expect(detectCompiledVCarveDepthWarnings(depth(6.35), 6.5)).toEqual([
      expect.stringContaining('leaves only 0.15 mm of stock under its floor'),
    ]);
    expect(detectCompiledVCarveDepthWarnings(depth(6.35), 6.5)[0]).toContain(
      'V-carve paths have no holding tabs',
    );
  });
});

describe('compiled relief depth warnings', () => {
  it('aggregates the exact deepest roughing or finishing pass per layer', () => {
    const job: Job = {
      groups: [reliefGroup('relief-rough', 4), reliefGroup('relief-finish', 7.5)],
    };

    expect(compiledReliefLayerDepths(job)).toEqual([
      { layerId: 'relief', depthMm: 7.5, depthText: '7.500' },
    ]);
    expect(detectCompiledReliefDepthWarnings(compiledReliefLayerDepths(job), 6.35)).toEqual([
      expect.stringContaining('actual compiled relief depth of 7.5 mm'),
    ]);
  });

  it('warns at the exact stock bottom and reaches the shared Save/Start warning surface', () => {
    expect(
      detectCompiledReliefDepthWarnings(
        compiledReliefLayerDepths({
          groups: [reliefGroup('relief-rough', 6.35)],
        }),
        6.35,
      ),
    ).toEqual([expect.stringContaining('reaches the configured stock bottom')]);

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
