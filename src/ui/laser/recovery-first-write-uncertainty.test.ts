import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import { createJobCheckpoint } from '../../core/recovery';
import {
  createLayer,
  createProject,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { mapControllerPointToScene, rebuildCanvasPlanForGcode } from '../state/canvas-motion-plan';
import { readJobCheckpoint, writeJobCheckpoint } from '../state/job-checkpoint-storage';
import { jobActions } from '../state/laser-job-actions';
import { captureLaserModeStartSnapshot } from '../state/laser-mode-start-evidence';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { recoveryRepository, RecoveryRepository } from '../state/recovery';
import { isCurrentExecutionArtifact } from '../state/recovery/execution-artifact';
import { executionArtifactIntegrityIsValid } from '../state/recovery/execution-artifact-integrity';
import {
  MemoryRecoveryStorageBackend,
  MemoryRecoveryGenerationStore,
} from '../state/recovery/testing';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing/execution-artifact-test-fixture';
import { runLaserRecoveryCapsuleFlow } from './laser-recovery-flow';
import { laserRecoveryPreviewMapping } from './laser-recovery-preview-route';
import { prepareStartJob } from './start-job-readiness';
import { streamResumeFromRawLine } from './start-job-resume-stream';
import { prepareArchivedRecoverySource } from './start-job-source';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

const originalStartJob = useLaserStore.getState().startJob;
const NOW = '2026-09-22T00:00:00.000Z';
const STATUS: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
};

beforeEach(() => {
  localStorage.clear();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    statusReport: STATUS,
    capabilities: grblDriver.capabilities,
    controllerSessionEpoch: 9,
    controllerSettings: { maxPowerS: 1_000, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: 9, observedAt: 1 },
    controllerQualification: { kind: 'qualified', epoch: 9, settings: 'verified' },
    // Overrides reported at 100%, so Start sends no ADR-355 reset ahead of the
    // program and the first write these tests reject is the program's own.
    ovCache: { feed: 100, rapid: 100, spindle: 100 },
  });
});

afterEach(() => {
  useLaserStore.setState({ ...initialLaserState(), startJob: originalStartJob });
  vi.restoreAllMocks();
});

describe('recovery source and first-write authority', () => {
  it('does not reuse mutable diagnostic coordinate metadata for the recovery runtime', async () => {
    const { artifact } = await fixture();
    const altered = {
      ...artifact,
      canvasPlan: {
        ...artifact.canvasPlan,
        device: { ...artifact.prepared.project.device, origin: 'front-right' as const },
        coordinateFrame: { kind: 'relative' as const, jobOriginOffset: { x: 999, y: 888 } },
      },
    };
    expect(isCurrentExecutionArtifact(altered)).toBe(true);
    expect(await executionArtifactIntegrityIsValid(altered)).toBe(true);
    const source = prepareArchivedRecoverySource(altered);
    if (source === null) throw new Error('Expected qualified source.');
    const runtime = rebuildCanvasPlanForGcode(source.canvasPlan, source.gcode);
    const point = { x: 5, y: 5, z: 0 };
    expect(mapControllerPointToScene(point, runtime)).toEqual(
      mapControllerPointToScene(point, laserRecoveryPreviewMapping(altered)),
    );
    expect(runtime.device).toEqual(artifact.prepared.project.device);
  });

  it.each([false, true])(
    'retains the attempted resume after a rejected first write (closed=%s)',
    async (closed) => {
      const { prepared, artifact, repository, capsule } = await fixture();
      const writes = installPrefixFailure(closed);
      const fromLine = firstBurnLine(prepared);

      expect(await runLaserRecoveryCapsuleFlow(capsule, repository, { fromLine })).toBe(false);

      expect(writes[0]).toContain('G1');
      const retained = repository.getSnapshot().recoveryCapsule;
      expect(retained?.runId).not.toBe(artifact.runId);
      expect(retained?.interruption.kind).toBe('write-failed');
      expect(retained?.ackedLines).toBe(0);
      if (retained?.artifact.kind !== 'exact-execution') throw new Error('Lost attempted resume.');
      expect(retained.artifact.laserResumeChain).toEqual([{ fromLine, version: 3 }]);
      expect(retained.artifact.gcode).toContain('resume preamble');
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(retained.claim).toBeUndefined();
    },
  );

  it('retires an older archive after a manual first write becomes uncertain', async () => {
    const { prepared, repository } = await fixture();
    const invalidate = vi
      .spyOn(recoveryRepository, 'noteUntrackedRunAccepted')
      .mockImplementation(() => repository.noteUntrackedRunAccepted());
    const writes = installPrefixFailure(false);
    const checkpoint = createJobCheckpoint({
      gcode: prepared.gcode,
      machineKind: 'laser',
      outputScope: DEFAULT_OUTPUT_SCOPE,
      nowIso: NOW,
    });
    writeJobCheckpoint(checkpoint);
    const laser = useLaserStore.getState();

    expect(
      await streamResumeFromRawLine(
        prepared.prepared.project,
        prepared.gcode,
        firstBurnLine(prepared),
        prepared.canvasPlan,
        captureLaserModeStartSnapshot(laser),
        laser,
      ),
    ).toBe(false);

    expect(writes[0]).toContain('G1');
    expect(invalidate).toHaveBeenCalledOnce();
    expect(repository.getSnapshot().recoveryCapsule).toBeNull();
    expect(readJobCheckpoint()?.resumeInFlight).toBe(true);
  });
});

function installPrefixFailure(closeBeforeRejection: boolean): string[] {
  const writes: string[] = [];
  const safeWrite = async (data: string): Promise<void> => {
    writes.push(data);
    // A WritableStream rejection does not prove the USB/controller received no
    // prefix. Also exercise onClose clearing all live ownership before reject.
    if (closeBeforeRejection)
      useLaserStore.setState({
        streamer: null,
        activeRunId: null,
        connection: { kind: 'disconnected' },
      });
    throw new Error('Transport rejected after transmitting a nonzero prefix.');
  };
  const refs = { driver: grblDriver } as Parameters<typeof jobActions>[2];
  const actions = jobActions(
    useLaserStore.setState,
    useLaserStore.getState,
    refs,
    safeWrite,
    () => grblDriver,
  );
  useLaserStore.setState({ startJob: actions.startJob });
  return writes;
}

async function fixture() {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: {
      layers: [createLayer({ id: 'line', color: '#ff0000' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 1, minY: 1, maxX: 9, maxY: 9 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  points: [
                    { x: 1, y: 1 },
                    { x: 9, y: 9 },
                    { x: 8, y: 8 },
                    { x: 2, y: 2 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const prepared = prepareStartJob(
    project,
    useLaserStore.getState().controllerSettings,
    { statusReport: STATUS, alarmCode: null, hasActiveStreamer: false },
    { startFrom: 'absolute', anchor: 'front-left' },
    DEFAULT_OUTPUT_SCOPE,
    undefined,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join('\n'));
  const artifact = await createCurrentTestExecutionArtifact({
    runId: 'previous-run',
    gcode: prepared.gcode,
    prepared: prepared.prepared,
    canvasPlan: prepared.canvasPlan,
    controllerSettings: useLaserStore.getState().controllerSettings,
    controllerObservation: { statusReport: STATUS, wco: STATUS.wco },
  });
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
    nowIso: () => NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  await repository.activateFreshRun(artifact.runId);
  await repository.interruptRun(artifact.runId, 5, {
    kind: 'disconnect',
    message: 'Original disconnect.',
  });
  const capsule = repository.getSnapshot().recoveryCapsule;
  if (capsule === null) throw new Error('Expected original recovery capsule.');
  return { prepared, artifact, repository, capsule };
}

function firstBurnLine(prepared: Awaited<ReturnType<typeof fixture>>['prepared']): number {
  const first = prepared.canvasPlan.manifest.blocks.find((block) => block.kind === 'process');
  if (first === undefined) throw new Error('Expected process movement.');
  return first.rawLineIndex + 1;
}
