import { describe, expect, it } from 'vitest';

import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import type { Job } from '../../core/job';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { detectCncReliefPlanningWarnings } from './cnc-relief-planning-warnings';
import { detectMachineJobWarnings } from './machine-job-warnings';

function pocketProject(
  stepoverPercent: number,
  pocketStrategy: 'offset' | 'raster-x' | 'raster-y' | 'adaptive' = 'offset',
): Project {
  const base = createProject();
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...base.scene,
      layers: [
        {
          ...createLayer({ id: 'pocket', name: 'Tray pocket', color: '#884400' }),
          output: true,
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            cutType: 'pocket',
            pocketStrategy,
            stepoverPercent,
          },
        },
      ],
    },
  };
}

function prepared(project: Project, job: Job) {
  return {
    ok: true as const,
    project,
    job,
    jobOriginOffset: { x: 0, y: 0 },
    advisories: [],
  };
}

describe('CNC relief planning warnings', () => {
  it('discloses stored out-of-range Stepover normalization without a new refusal', () => {
    const low = detectCncReliefPlanningWarnings(pocketProject(1));
    const high = detectCncReliefPlanningWarnings(pocketProject(200));

    expect(low).toHaveLength(1);
    expect(low[0]).toContain('is 1%');
    expect(low[0]).toContain('use 10%');
    expect(high).toHaveLength(1);
    expect(high[0]).toContain('is 200%');
    expect(high[0]).toContain('use 85%');
    expect(detectCncReliefPlanningWarnings(pocketProject(40))).toEqual([]);
  });

  it('does not render an exact positive Stepover as zero', () => {
    expect(detectCncReliefPlanningWarnings(pocketProject(1e-9))).toContainEqual(
      expect.stringContaining('1e-9%'),
    );
  });

  it('omits unused adaptive-pocket Stepover but retains it when relief consumes it', () => {
    const adaptive = pocketProject(200, 'adaptive');
    expect(detectCncReliefPlanningWarnings(adaptive)).toEqual([]);

    const [layer] = adaptive.scene.layers;
    if (layer === undefined) throw new Error('fixture must have a layer');
    const reliefProject: Project = {
      ...adaptive,
      scene: {
        ...adaptive.scene,
        objects: [
          {
            kind: 'relief',
            id: 'adaptive-relief',
            source: 'adaptive-relief.png',
            reliefSource: testReliefHeightfield({
              width: 2,
              height: 2,
              physicalWidthMm: 20,
              physicalHeightMm: 20,
              maxDepthMm: 3,
              samplesU8: [0, 255, 128, 255],
            }),
            targetWidthMm: 20,
            reliefDepthMm: 3,
            color: layer.color,
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
            transform: IDENTITY_TRANSFORM,
          },
        ],
      },
    };

    const warnings = detectCncReliefPlanningWarnings(reliefProject);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('200%');
  });

  it('uses exact compiled evidence when source geometry checks are unavailable', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        stepoverOperations: [{ layerId: 'pocket', stepoverPercent: 200 }],
      },
    };

    const warnings = detectCncReliefPlanningWarnings(project, job, 'compiled-evidence-only');

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Tray pocket');
    expect(warnings[0]).toContain('200%');
  });

  it('treats an exact empty Stepover sidecar as authoritative', () => {
    const project = pocketProject(200);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        stepoverOperations: [],
        reliefPlans: [],
        offsetLadderDiagnostics: [],
      },
    };

    expect(detectCncReliefPlanningWarnings(project, job, 'full')).toEqual([]);
  });

  it('discloses exact oversized grids and ball-nose scallop targets above the radius', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        reliefPlans: [
          {
            layerId: 'pocket',
            source: 'portrait.png',
            stage: 'finishing',
            widthCells: 2_001,
            heightCells: 2_001,
            cellSizeMm: 0.05,
            toolDiameterMm: 1,
            toolKind: 'ball-nose',
            rowSpacingMm: 1,
            scallopMm: 0.75,
          },
        ],
      },
    };

    const warnings = detectMachineJobWarnings(
      project,
      null,
      null,
      prepared(project, job),
      'compiled-evidence-only',
    );

    expect(warnings).toContainEqual(expect.stringContaining('4,004,001 cells'));
    expect(warnings).toContainEqual(expect.stringContaining('did not coarsen'));
    expect(warnings).toContainEqual(
      expect.stringContaining('outside the minor-sagitta cusp domain'),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining('limits the cusp calculation to the cutter radius'),
    );
  });

  it('discloses a source ball-nose target before compiled evidence is available', () => {
    const base = pocketProject(40);
    const [priorLayer] = base.scene.layers;
    if (priorLayer === undefined) throw new Error('fixture must have a layer');
    const layer = {
      ...priorLayer,
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        reliefFinishToolId: 'bn-3175',
        reliefScallopMm: 2,
      },
    };
    const project: Project = {
      ...base,
      scene: {
        layers: [layer],
        objects: [
          {
            kind: 'relief',
            id: 'portrait',
            source: 'portrait.png',
            reliefSource: testReliefHeightfield({
              width: 2,
              height: 2,
              physicalWidthMm: 20,
              physicalHeightMm: 20,
              maxDepthMm: 3,
              samplesU8: [0, 255, 128, 255],
            }),
            targetWidthMm: 20,
            reliefDepthMm: 3,
            color: layer.color,
            bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
            transform: IDENTITY_TRANSFORM,
          },
        ],
      },
    };

    const warnings = detectCncReliefPlanningWarnings(project);

    expect(warnings).toContainEqual(expect.stringContaining('portrait.png'));
    expect(warnings).toContainEqual(
      expect.stringContaining('outside the minor-sagitta cusp domain'),
    );
    expect(warnings).toContainEqual(expect.stringContaining('3.175 mm row spacing'));
  });

  it('accepts a ball-nose scallop exactly equal to the cutter radius', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        reliefPlans: [
          {
            layerId: 'pocket',
            source: 'portrait.png',
            stage: 'finishing',
            widthCells: 2,
            heightCells: 2,
            cellSizeMm: 0.1,
            toolDiameterMm: 1,
            toolKind: 'ball-nose',
            rowSpacingMm: 1,
            scallopMm: 0.5,
          },
        ],
      },
    };

    expect(detectCncReliefPlanningWarnings(project, job, 'compiled-evidence-only')).toEqual([]);
  });

  it('does not derive source-only advisories in compiled-evidence-only mode', () => {
    expect(
      detectCncReliefPlanningWarnings(pocketProject(200), { groups: [] }, 'compiled-evidence-only'),
    ).toEqual([]);
  });

  it('retains non-V-carve pass-limit evidence for exact prepared jobs', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        offsetLadderDiagnostics: [{ layerId: 'pocket', kind: 'pass-limit' }],
      },
    };

    const warnings = detectMachineJobWarnings(
      project,
      null,
      null,
      prepared(project, job),
      'compiled-evidence-only',
    );

    expect(warnings).toContainEqual(expect.stringContaining('Tray pocket'));
    expect(warnings).toContainEqual(expect.stringContaining('route/ring limits'));
  });
});
