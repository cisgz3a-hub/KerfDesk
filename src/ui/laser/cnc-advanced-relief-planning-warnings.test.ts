import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import {
  createProject,
  createLayer,
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
} from '../../core/scene';
import { detectCncReliefPlanningWarnings } from './cnc-relief-planning-warnings';
function pocketProject(stepoverPercent: number) {
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
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const, stepoverPercent },
        },
      ],
    },
  };
}
describe('compiled advanced relief disclosures', () => {
  it('uses exact rest stock evidence, including an empty selection and full-finish fallback', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        reliefPlans: [
          {
            layerId: 'pocket',
            source: 'retained.png',
            stage: 'rest-finishing',
            widthCells: 10,
            heightCells: 10,
            cellSizeMm: 0.2,
            toolDiameterMm: 1,
            toolKind: 'ball-nose',
            scallopMm: 0.1,
            predecessorToolId: 'large-ball',
            targetRevision: 7,
            residualThresholdMm: 0.04,
            maximumResidualMm: 0.8,
            selectedCells: 0,
            restFallbackReason: 'Prediction work budget exceeded; full fine finishing retained.',
          },
        ],
      },
    };
    const warnings = detectCncReliefPlanningWarnings(project, job, 'compiled-evidence-only');
    expect(warnings).toContainEqual(
      expect.stringContaining('cutter "large-ball" at target revision 7'),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining('Threshold 0.04 mm. Selected 0 target cells.'),
    );
    expect(warnings).toContainEqual(expect.stringContaining('upper estimate 0.8 mm'));
    expect(warnings).toContainEqual(expect.stringContaining('not measured material'));
    expect(warnings).toContainEqual(expect.stringContaining('continuous swept-volume proof'));
    expect(warnings).toContainEqual(expect.stringContaining('full fine finishing retained'));
  });
  it('discloses vertical projection convention and actual contact lifts from the compiled target', () => {
    const project = pocketProject(40);
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        reliefPlans: [
          {
            layerId: 'pocket',
            source: 'relief target',
            stage: 'projection',
            widthCells: 20,
            heightCells: 20,
            cellSizeMm: 0.1,
            toolDiameterMm: 1,
            toolKind: 'ball-nose',
            targetRevision: 9,
            verticalDepthMm: 0.3,
            requestedSampleSpacingMm: 0.25,
            restFallbackReason:
              '3 projected samples were lifted for cutter reach or excluded stock; nominal vertical depth is not reached there.',
          },
        ],
      },
    };
    const warnings = detectCncReliefPlanningWarnings(project, job, 'compiled-evidence-only');
    expect(warnings).toContainEqual(
      expect.stringContaining('0.3 mm vertical depth at target revision 9'),
    );
    expect(warnings).toContainEqual(expect.stringContaining('0.1 mm sampled surface grid'));
    expect(warnings).toContainEqual(expect.stringContaining('Requested path spacing is 0.25 mm'));
    expect(warnings).toContainEqual(
      expect.stringContaining('does not verify actual remaining stock'),
    );
    expect(warnings).toContainEqual(
      expect.stringContaining('along Z rather than the surface normal'),
    );
    expect(warnings).toContainEqual(expect.stringContaining('3 projected samples were lifted'));
    expect(
      detectCncReliefPlanningWarnings(
        project,
        { groups: [], cncCompilation: { vcarveOperations: [], reliefPlans: [] } },
        'compiled-evidence-only',
      ),
    ).toEqual([]);
  });
  it('includes the rest tapered-tip scallop limit using exact evidence', () => {
    const job: Job = {
      groups: [],
      cncCompilation: {
        vcarveOperations: [],
        reliefPlans: [
          {
            layerId: 'pocket',
            source: 'tapered rest',
            stage: 'rest-finishing',
            widthCells: 2,
            heightCells: 2,
            cellSizeMm: 0.1,
            toolDiameterMm: 6.35,
            toolTipDiameterMm: 1,
            toolKind: 'tapered-ball-nose',
            rowSpacingMm: 1,
            scallopMm: 0.75,
          },
        ],
      },
    };
    const warnings = detectCncReliefPlanningWarnings(
      pocketProject(40),
      job,
      'compiled-evidence-only',
    );
    expect(warnings).toContainEqual(expect.stringContaining('above the 0.5 mm tip radius'));
    expect(warnings.join(' ')).not.toContain('undefined');
  });
});
