import { describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import { buildCanvasMotionPlan, mapControllerPointToScene } from '../state/canvas-motion-plan';
import {
  isCurrentExecutionArtifact,
  type ExecutionArtifactV1,
} from '../state/recovery/execution-artifact';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import { packMotionManifest } from '../state/recovery/packed-motion-manifest';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { pickRecoveryMovement } from './laser-recovery-picker-model';
import { laserRecoveryPreviewPlan } from './laser-recovery-preview-plan';

const PROGRAM = 'G21\nG90\nM4 S0\nG0 X10 Y20\nG1 X20 S300\nS0\nG0 Y21\nG1 X10 S400\nM5';

describe('sealed laser restart preview', () => {
  it.each(['plain', 'packed'] as const)(
    'ignores altered %s diagnostic geometry and uses the sealed program and profile',
    async (encoding) => {
      const project = createProject();
      const prepared = {
        ok: true,
        project,
        job: { groups: [] },
        jobOriginOffset: { x: 0, y: 0 },
      } as Extract<PreparedOutput, { readonly ok: true }>;
      const canvasPlan = buildCanvasMotionPlan({
        prepared,
        gcode: PROGRAM,
        machine: { statusReport: null, alarmCode: null, hasActiveStreamer: false },
      });
      const artifact = await createCurrentTestExecutionArtifact({
        runId: `preview-${encoding}`,
        gcode: PROGRAM,
        prepared,
        canvasPlan,
      });
      const alteredManifest = {
        ...canvasPlan.manifest,
        blocks: canvasPlan.manifest.blocks.map((block, index) => ({
          ...block,
          // A finite, in-range, monotonic edit passes the diagnostic shape guard.
          rawLineIndex: index === 1 ? block.rawLineIndex + 1 : block.rawLineIndex,
          points: block.points.map((point) => ({ ...point, x: point.x + 1_000 })),
        })),
      };
      const alteredCanvas = {
        ...canvasPlan,
        device: { ...project.device, origin: 'front-right' as const },
        coordinateFrame: { kind: 'relative' as const, jobOriginOffset: { x: 999, y: 888 } },
      };
      const altered: ExecutionArtifactV1 = {
        ...artifact,
        canvasPlan:
          encoding === 'packed'
            ? { ...alteredCanvas, manifest: packMotionManifest(alteredManifest) }
            : { ...alteredCanvas, manifest: alteredManifest },
      };
      expect(isCurrentExecutionArtifact(altered)).toBe(true);
      expect(await executionArtifactIntegrityIsValid(altered)).toBe(true);
      const preview = laserRecoveryPreviewPlan(altered);
      expect(preview).toEqual(laserRecoveryPreviewPlan(artifact));
      const point = mapControllerPointToScene({ x: 15, y: 20, z: 0 }, preview);
      expect(pickRecoveryMovement(preview, point, 0.01, 1)).toBe(5);
      expect(laserRecoveryPreviewPlan(altered)).toBe(preview);
    },
  );

  it('uses the sealed reported work position and units for an incremental first movement', async () => {
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'preview-inches-observation',
      gcode: 'G21\nG91\nM4 S300\nG1 X10\nM5',
      controllerSettings: { reportInches: true },
      controllerObservation: {
        statusReport: {
          state: 'Idle',
          subState: null,
          mPos: null,
          wPos: { x: 1, y: 2, z: 0 },
          wco: { x: 0.5, y: 0.25, z: 0 },
          feed: 0,
          spindle: 0,
        },
      },
    });
    const preview = laserRecoveryPreviewPlan(artifact);
    expect(preview.manifest.blocks[0]?.points).toEqual([
      { x: 25.4, y: 50.8, z: 0 },
      { x: 35.4, y: 50.8, z: 0 },
    ]);
    expect(preview.coordinateFrame).toEqual({
      kind: 'machine',
      workOffsetMm: { x: 12.7, y: 6.35, z: 0 },
    });
  });
});
