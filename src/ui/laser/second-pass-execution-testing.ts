import {
  buildLaserSecondPassProgram,
  type LaserSecondPassSelection,
} from '../../core/laser-second-pass';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import type { JobOriginPlacement } from '../../core/job';
import type { DeviceProfile } from '../../core/devices';
import { fingerprintGcode } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
} from '../../core/scene';
import type { PreparedStartProgram } from '../state/framed-run';
import { useLaserStore } from '../state/laser-store';
import type { ExecutionArtifactV1, RecoveryRepository } from '../state/recovery';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { prepareStartJob } from './start-job-readiness';

export async function createSecondPassExecutionFixture(
  repository: RecoveryRepository,
  origin?: JobOriginPlacement,
  device?: DeviceProfile,
): Promise<{
  source: ExecutionArtifactV1;
  prepared: PreparedStartProgram;
  selection: LaserSecondPassSelection;
}> {
  const project = sourceProject(device);
  const laser = useLaserStore.getState();
  const original = prepareStartJob(
    project,
    laser.controllerSettings,
    { ...laser, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    origin,
    false,
  );
  if (!original.ok) throw new Error(original.messages.join(' '));
  const source = await createCurrentTestExecutionArtifact({
    runId: 'run-second-pass-source',
    gcode: original.gcode,
    prepared: original.prepared,
    canvasPlan: original.canvasPlan,
    ...(origin === undefined ? {} : { jobOrigin: origin }),
  });
  await repository.stageArtifact(source);
  await repository.activateFreshRun(source.runId);
  await repository.completeRun(source.runId);
  const process = original.canvasPlan.manifest.blocks.find((block) => block.kind === 'process');
  const from = process?.points[0];
  const to = process?.points.at(-1);
  if (from === undefined || to === undefined)
    throw new Error('Expected original engraving motion.');
  const selection: LaserSecondPassSelection = {
    version: 1,
    maxPowerS: 1000,
    strokes: [
      {
        id: 'one',
        mode: 'paint',
        radiusMm: 2,
        powerScale: 1.2,
        points: [{ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }],
      },
    ],
  };
  const derived = buildLaserSecondPassProgram(source.gcode, selection);
  if (derived.kind === 'error') throw new Error(derived.message);
  return {
    source,
    selection,
    prepared: {
      ...original,
      gcode: derived.gcode,
      metrics: {
        ...original.metrics,
        jobBounds: derived.bounds,
        motionBounds: derived.motionBounds,
        frameJobBounds: derived.bounds,
        frameMotionBounds: derived.motionBounds,
      },
      canvasPlan: {
        ...original.canvasPlan,
        manifest: buildMotionManifest(derived.gcode, { machineKind: 'laser' }),
        fingerprint: fingerprintGcode(derived.gcode),
      },
    },
  };
}

// eslint-disable-next-line no-restricted-syntax -- Test artwork color, not application chrome.
const TEST_SCENE_COLOR = '#ff0000';

function sourceProject(device?: DeviceProfile) {
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      layers: [
        { ...createLayer({ id: 'red', color: TEST_SCENE_COLOR }), power: 30, airAssist: false },
      ],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 4, minY: 6, maxX: 24, maxY: 6 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: TEST_SCENE_COLOR,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 4, y: 6 },
                    { x: 24, y: 6 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
