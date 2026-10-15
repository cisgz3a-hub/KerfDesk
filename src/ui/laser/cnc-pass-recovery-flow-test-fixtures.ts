import { expect } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { JobInterruptionKind } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { RecoveryRepository, type RecoveryCapsule } from '../state/recovery';
import {
  createCurrentTestExecutionArtifact,
  MemoryRecoveryGenerationStore,
  MemoryRecoveryStorageBackend,
} from '../state/recovery/testing';
import { prepareCurrentStartJob } from './start-job-source';

const NOW = '2026-07-16T10:00:00.000Z';
const LATER = '2026-07-16T10:01:00.000Z';
// Scene-data colour for the archived CNC artwork, not UI chrome.
// eslint-disable-next-line no-restricted-syntax
const ARTWORK_COLOR = '#ff0000';
export const ARCHIVED_WCO = { x: 0, y: 0, z: 0 };
const lineObject: SceneObject = {
  kind: 'imported-svg',
  id: 'line-object',
  source: 'line.svg',
  bounds: { minX: 10, minY: 10, maxX: 70, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: ARTWORK_COLOR,
      polylines: [
        {
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 50, y: 10 },
            { x: 70, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

// Three 1 mm stepdowns so boundary slicing and late-pick have real passes.
export function recoveryProject() {
  return {
    ...createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong' as const,
      rxBufferBytes: 96,
    }),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      ...EMPTY_SCENE,
      objects: [lineObject],
      layers: [
        {
          ...createLayer({ id: 'red', color: ARTWORK_COLOR }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 3, depthPerPassMm: 1 },
        },
      ],
    },
  };
}

export function repository(): RecoveryRepository {
  return new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => LATER,
  });
}

export async function saveInterruptedRun(
  repo: RecoveryRepository,
  options?: {
    readonly interruptionKind?: JobInterruptionKind;
    readonly archiveWco?: boolean;
    readonly workOffset?: typeof ARCHIVED_WCO;
  },
): Promise<RecoveryCapsule> {
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    laser,
    useCameraStore.getState(),
  );
  if (!prepared.ok) {
    throw new Error(`Expected ready CNC job: ${prepared.messages.join('; ')}`);
  }
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'run-archived-cnc',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    ...(prepared.jobOrigin === undefined ? {} : { jobOrigin: prepared.jobOrigin }),
    canvasPlan: prepared.canvasPlan,
    ...(prepared.cncToolPlan === undefined ? {} : { cncToolPlan: prepared.cncToolPlan }),
    controllerSettings: laser.controllerSettings,
    controllerObservation: {
      statusReport: laser.statusReport,
      ...(options?.archiveWco === false
        ? {}
        : { wco: { ...(options?.workOffset ?? ARCHIVED_WCO) } }),
      overrides: laser.ovCache,
      accessories: laser.accessoryCache ?? null,
      workZZeroEvidence: laser.workZZeroEvidence,
      activeControllerKind: laser.activeControllerKind,
      controllerSessionEpoch: laser.controllerSessionEpoch,
    },
    createdAtIso: NOW,
  });
  expect((await repo.initialize()).ok).toBe(true);
  expect((await repo.stageArtifact(artifact)).ok).toBe(true);
  expect((await repo.activateFreshRun(artifact.runId, NOW)).ok).toBe(true);
  expect(
    (
      await repo.interruptRun(
        artifact.runId,
        Math.min(3, artifact.sendableLines),
        {
          kind: options?.interruptionKind ?? 'disconnect',
          message: 'USB connection was lost.',
        },
        LATER,
      )
    ).ok,
  ).toBe(true);
  const capsule = repo.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected interrupted CNC recovery capsule.');
  return capsule;
}
