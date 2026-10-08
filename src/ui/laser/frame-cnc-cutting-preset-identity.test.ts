import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CNC_CONTEXT_PRESET, CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import { cncCuttingPresetPatch, cncCuttingValues } from '../../core/cnc/cutting-preset';
import type { CncCuttingPreset } from '../../core/scene/cnc-cutting-preset';
import { CNC_CUTTING_STAGES, type CncStageRecipe } from '../../core/scene/cnc-stage-recipe';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncLayerSettings,
} from '../../core/scene/machine';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { framedRunReadinessIssue } from './framed-run-readiness';
import { installReviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';
import { prepareCurrentStartJob } from './start-job-source';

const SETTINGS: CncLayerSettings = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  ...cncCuttingValues(CNC_CONTEXT_PRESET),
  cutType: 'profile-on-path',
  toolId: CNC_CONTEXT_TOOL.id,
  depthMm: 1.2,
};
const STAGE: CncStageRecipe = {
  toolId: CNC_CONTEXT_TOOL.id,
  feedMmPerMin: 800,
  plungeMmPerMin: 200,
  spindleRpm: 12000,
  depthPerPassMm: 1.2,
  cuttingPreset: CNC_CONTEXT_PRESET,
};

beforeEach(() => {
  installFrameOnceProject();
  useStore.setState((state) => ({
    project: {
      ...state.project,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: [CNC_CONTEXT_TOOL],
        toolId: CNC_CONTEXT_TOOL.id,
      },
      scene: {
        ...state.project.scene,
        layers: state.project.scene.layers.map((layer) => ({ ...layer, cnc: SETTINGS })),
      },
    },
  }));
  ensureFramedRunInvalidationSubscriptions();
});
afterEach(() => useLaserStore.setState(initialLaserState()));

function patchCnc(patch: Partial<CncLayerSettings>): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        layers: state.project.scene.layers.map((layer) => ({
          ...layer,
          cnc: { ...(layer.cnc ?? SETTINGS), ...patch },
        })),
      },
    },
  }));
}

function signatures() {
  return { spatial: currentFrameSpatialSignature(), exact: currentReplayExecutionSignature() };
}
function expectProcessOnly(previous: ReturnType<typeof signatures>): void {
  expect(currentFrameSpatialSignature()).toBe(previous.spatial);
  expect(currentReplayExecutionSignature()).not.toBe(previous.exact);
}

const SNAPSHOT_EDITS: ReadonlyArray<[string, Partial<CncCuttingPreset>]> = [
  ['ID', { id: 'another-library-record' }],
  ['name', { name: 'Renamed trial record' }],
  ['provenance', { provenance: { kind: 'manufacturer', reference: 'Recorded source changed' } }],
  [
    'qualification',
    {
      qualification: { status: 'operator-qualified', notes: 'Operator notes; test metadata only.' },
    },
  ],
  ['context', { context: { ...CNC_CONTEXT_PRESET.context!, materialKey: 'other-material' } }],
  ['recorded cutting values', { feedMmPerMin: 900, depthPerPassMm: 0.5, stepoverPercent: 20 }],
];

describe('CNC cutting data is exact execution evidence, separate from spatial Frame proof', () => {
  it.each(SNAPSHOT_EDITS)('keeps Frame identity for primary snapshot %s edits', (_label, patch) => {
    patchCnc({ cuttingPreset: CNC_CONTEXT_PRESET });
    const before = signatures();
    patchCnc({ cuttingPreset: { ...CNC_CONTEXT_PRESET, ...patch } });
    expectProcessOnly(before);
    expect(useStore.getState().project.scene.layers[0]?.cnc?.cuttingPreset).toEqual({
      ...CNC_CONTEXT_PRESET,
      ...patch,
    });
  });

  it.each([{ feedMmPerMin: 900 }, { plungeMmPerMin: 220 }, { spindleRpm: 15000 }])(
    'keeps primary process edits spatially neutral: %j',
    (patch) => {
      const before = signatures();
      patchCnc(patch);
      expectProcessOnly(before);
    },
  );

  it.each(CNC_CUTTING_STAGES)('keeps nested %s snapshot changes spatially neutral', (stage) => {
    patchCnc({ stageRecipes: { [stage]: STAGE } });
    const before = signatures();
    const next: CncStageRecipe = {
      ...STAGE,
      cuttingPreset: {
        ...CNC_CONTEXT_PRESET,
        id: 'another-stage-record',
        name: 'New stage record',
        provenance: { kind: 'imported', reference: 'Changed stage source' },
        qualification: { status: 'operator-qualified', notes: 'Stage test metadata only.' },
      },
    };
    patchCnc({ stageRecipes: { [stage]: next } });
    expectProcessOnly(before);
    expect(useStore.getState().project.scene.layers[0]?.cnc?.stageRecipes?.[stage]).toEqual(next);
  });

  it.each([{ feedMmPerMin: 900 }, { plungeMmPerMin: 220 }, { spindleRpm: 15000 }])(
    'keeps nested stage process edits spatially neutral: %j',
    (patch) => {
      patchCnc({ stageRecipes: { 'profile-finish': STAGE } });
      const before = signatures();
      patchCnc({ stageRecipes: { 'profile-finish': { ...STAGE, ...patch } } });
      expectProcessOnly(before);
    },
  );

  it.each([
    { depthMm: 2.4 },
    { depthPerPassMm: 0.5 },
    { stepoverPercent: 20 },
    { toolId: 'different-tool' },
    { cutType: 'profile-outside' as const },
    { pocketStrategy: 'adaptive' as const },
  ])('still invalidates spatial identity for canonical coordinate/strategy edits: %j', (patch) => {
    const before = signatures();
    patchCnc(patch);
    expect(currentFrameSpatialSignature()).not.toBe(before.spatial);
    expect(currentReplayExecutionSignature()).not.toBe(before.exact);
  });

  it.each([
    { toolId: 'different-stage-tool' },
    { depthPerPassMm: 0.5 },
    { futureStageBoundaryMm: 2 },
  ])('preserves stage coordinate fields, including unknown future fields: %j', (patch) => {
    patchCnc({ stageRecipes: { 'profile-finish': STAGE } });
    const before = signatures();
    patchCnc({ stageRecipes: { 'profile-finish': { ...STAGE, ...patch } } });
    expect(currentFrameSpatialSignature()).not.toBe(before.spatial);
    expect(currentReplayExecutionSignature()).not.toBe(before.exact);
  });

  it('retains a completed Frame after reviewed Apply and prepares the current exact F/S bytes', async () => {
    const framed = await installReviewPendingFramedRunPermitForCurrentState();
    patchCnc(cncCuttingPresetPatch(CNC_CONTEXT_PRESET));
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    expect(framedRunReadinessIssue(framed)).toBeNull();

    patchCnc(
      cncCuttingPresetPatch({
        ...CNC_CONTEXT_PRESET,
        feedMmPerMin: 900,
        plungeMmPerMin: 220,
        spindleRpm: 9000,
      }),
    );
    expect(useLaserStore.getState().completedFrame).toBe(framed);
    expect(framedRunReadinessIssue(framed)).toBeNull();
    const prepared = await prepareCurrentStartJob(
      useStore.getState(),
      useLaserStore.getState(),
      useCameraStore.getState(),
      undefined,
      false,
    );
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw new Error(prepared.messages.join(' '));
    expect(prepared.gcode).toMatch(/F900(?:\s|$)/);
    expect(prepared.gcode).toMatch(/F220(?:\s|$)/);
    expect(prepared.gcode).toMatch(/S9000(?:\s|$)/);
    expect(prepared.gcode).not.toBe(framed.candidate.preparedStart.gcode);
    expect(prepared.canvasPlan.retentionKey).not.toBe(framed.candidate.executionSignature);
    expect(prepared.metrics.frameJobBounds).toEqual(
      framed.candidate.preparedStart.metrics.frameJobBounds,
    );
    expect(prepared.metrics.frameMotionBounds).toEqual(
      framed.candidate.preparedStart.metrics.frameMotionBounds,
    );
  });

  it('still clears completed Frame for a real depth change and does not resurrect it on revert', async () => {
    await installReviewPendingFramedRunPermitForCurrentState();
    patchCnc({ depthMm: 2.4 });
    expect(useLaserStore.getState().completedFrame).toBeNull();
    patchCnc({ depthMm: SETTINGS.depthMm });
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });
});
