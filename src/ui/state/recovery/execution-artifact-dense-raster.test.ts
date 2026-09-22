import { describe, expect, it } from 'vitest';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import type { MotionManifest } from '../../../core/job/motion-manifest';
import {
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type Project,
} from '../../../core/scene';
import { recoveryArtifactPreparedProgramMatches } from '../../laser/recovery-artifact-binding';
import { pickRecoveryMovement } from '../../laser/laser-recovery-picker-model';
import { buildLaserRecoveryPreviewRoute } from '../../laser/laser-recovery-preview-route';
import { prepareStartJob } from '../../laser/start-job-readiness';
import { classifyCanvasPreparation } from '../../workspace/canvas-preparation-policy';
import { mapControllerPointToScene } from '../canvas-motion-plan';
import { executionArtifactCanvasPlan } from './execution-artifact-canvas';
import { MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES } from './execution-artifact-size';
import { unpackMotionManifest } from './packed-motion-manifest';
import { MemoryRecoveryStorageBackend } from './recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import { RecoveryRepository } from './recovery-repository';
import { createCurrentTestExecutionArtifact } from './testing/execution-artifact-test-fixture';

const NOW = '2026-09-21T00:00:00.000Z';

describe('dense Falcon image recovery archive', () => {
  it('retains the exact 400 by 400 raster through interruption and repository reload', async () => {
    const project = denseImageProject(400);
    expect(classifyCanvasPreparation(project)).toBe('background-worker');
    const source = prepareStartJob(
      project,
      { laserModeEnabled: true, maxPowerS: 1_000, minPowerS: 0 },
      {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: { x: 0, y: 0, z: 0 },
          wPos: null,
          wco: { x: 0, y: 0, z: 0 },
          feed: 0,
          spindle: 0,
        },
        alarmCode: null,
        hasActiveStreamer: false,
      },
      { startFrom: 'absolute', anchor: 'front-left' },
      DEFAULT_OUTPUT_SCOPE,
      undefined,
      false,
    );
    if (!source.ok) throw new Error(source.messages.join('\n'));
    expect(source.canvasPlan.manifest.blocks.length).toBeGreaterThan(160_000);
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'dense-falcon-image',
      gcode: source.gcode,
      prepared: source.prepared,
      canvasPlan: source.canvasPlan,
      createdAtIso: NOW,
    });
    expect(artifact.estimatedArtifactBytes).toBeLessThan(MAX_EXECUTION_ARTIFACT_ESTIMATED_BYTES);
    const backend = new MemoryRecoveryStorageBackend();
    const generationStore = new MemoryRecoveryGenerationStore();
    const repositoryOptions = {
      backend,
      generationStore,
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    };
    const repository = new RecoveryRepository(repositoryOptions);
    expect((await repository.stageArtifact(artifact)).ok).toBe(true);
    expect((await repository.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
    const halfway = Math.floor(artifact.sendableLines / 2);
    expect(
      (
        await repository.interruptRun(
          artifact.runId,
          halfway,
          { kind: 'disconnect', message: 'Controller disconnected.' },
          NOW,
        )
      ).ok,
    ).toBe(true);

    const reopened = new RecoveryRepository(repositoryOptions);
    expect((await reopened.initialize()).ok).toBe(true);
    const capsule = reopened.getSnapshot().recoveryCapsule;
    expect(capsule?.ackedLines).toBe(halfway);
    if (capsule?.artifact.kind !== 'exact-execution') throw new Error('Missing exact archive.');
    expect(capsule.artifact.gcode).toBe(source.gcode);
    expect(capsule.artifact.prepared.project).toEqual(source.prepared.project);
    expect(recoveryArtifactPreparedProgramMatches(capsule.artifact)).toBe(true);
    const restored = executionArtifactCanvasPlan(capsule.artifact);
    expectExactRoute(restored.manifest, source.canvasPlan.manifest);
    const { manifest, ...sourcePlacement } = source.canvasPlan;
    void manifest;
    const { manifest: restoredManifest, ...restoredPlacement } = restored;
    void restoredManifest;
    expect(restoredPlacement).toEqual(sourcePlacement);
    expect(executionArtifactCanvasPlan(capsule.artifact)).toBe(restored);
    const block = source.canvasPlan.manifest.blocks.find(
      (candidate) => candidate.kind === 'process' && candidate.sendableLineIndex >= halfway,
    );
    if (block === undefined || block.points[0] === undefined || block.points[1] === undefined) {
      throw new Error('Missing original halfway engraving segment.');
    }
    const point = mapControllerPointToScene(
      {
        x: (block.points[0].x + block.points[1].x) / 2,
        y: (block.points[0].y + block.points[1].y) / 2,
        z: (block.points[0].z + block.points[1].z) / 2,
      },
      source.canvasPlan,
    );
    // The picker route is derived from the sealed program, not the stored plan,
    // and consumed in packed form; unpacking it must reproduce every point.
    const selectable = buildLaserRecoveryPreviewRoute(capsule.artifact);
    expectExactRoute(unpackMotionManifest(selectable.manifest), source.canvasPlan.manifest);
    expect(pickRecoveryMovement(selectable, point, 0.01, block.rawLineIndex + 1)).toBe(
      block.rawLineIndex + 1,
    );
  }, 60_000);
});

/** Walk every original coordinate independently of the packing layout without
 * asking a generic assertion matcher to traverse hundreds of thousands of objects. */
function expectExactRoute(actual: MotionManifest, expected: MotionManifest): void {
  expect(actual.blocks.length).toBe(expected.blocks.length);
  expect(actual.totalRouteMm).toBe(expected.totalRouteMm);
  expect(actual.sendableLineCount).toBe(expected.sendableLineCount);
  expect(actual.firstProcessPoint).toEqual(expected.firstProcessPoint);
  expect(actual.finalPoint).toEqual(expected.finalPoint);
  const blockFields = [
    'rawLineIndex',
    'sendableLineIndex',
    'kind',
    'programLineNumber',
    'lengthMm',
    'routeStartMm',
    'routeEndMm',
  ] as const;
  for (let index = 0; index < expected.blocks.length; index += 1) {
    const left = actual.blocks[index];
    const right = expected.blocks[index];
    if (
      left === undefined ||
      right === undefined ||
      !blockFields.every((field) => Object.is(left[field], right[field])) ||
      left.points.length !== right.points.length
    ) {
      throw new Error(`Archived movement ${index} differs from the original.`);
    }
    for (let point = 0; point < right.points.length; point += 1) {
      const actualPoint = left.points[point];
      const expectedPoint = right.points[point];
      if (
        actualPoint === undefined ||
        expectedPoint === undefined ||
        !(['x', 'y', 'z'] as const).every((axis) =>
          Object.is(actualPoint[axis], expectedPoint[axis]),
        )
      ) {
        throw new Error(`Archived movement ${index}, point ${point} differs from the original.`);
      }
    }
  }
}

function denseImageProject(pixels: number): Project {
  const luma = Array.from({ length: pixels * pixels }, (_, index) =>
    (index + Math.floor(index / pixels)) % 2 ? '\xff' : '\0',
  ).join('');
  const base = createProject(FALCON_A1_PRO_GRBLHAL_PROFILE);
  return {
    ...base,
    scene: {
      layers: [
        {
          ...createLayer({ id: 'image', color: '#808080', mode: 'image' }),
          power: 40,
          linesPerMm: 10,
          ditherAlgorithm: 'threshold',
          imageBidirectional: true,
        },
      ],
      objects: [
        {
          kind: 'raster-image',
          id: 'image',
          source: 'checkerboard.png',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          lumaBase64: btoa(luma),
          pixelWidth: pixels,
          pixelHeight: pixels,
          dither: 'threshold',
          linesPerMm: 10,
          color: '#808080',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 10, minY: 10, maxX: 10 + pixels / 10, maxY: 10 + pixels / 10 },
        },
      ],
    },
  };
}
