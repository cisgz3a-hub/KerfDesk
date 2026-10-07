import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { fingerprintGcode } from '../../core/recovery';
import { installJobCheckpointTracking } from '../app/use-job-checkpoint';
import type { CanvasMotionPlan, LiveCanvasLifecycle } from './canvas-motion-plan';
import {
  connect,
  flush,
  installResetOwnershipFixtureHooks,
} from './laser-reset-response.test-support';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';
import { RecoveryRepository } from './recovery';
import { MemoryRecoveryStorageBackend } from './recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery/recovery-generation';
import { createCurrentTestExecutionArtifact } from './recovery/testing';

const GCODE = Array.from({ length: 40 }, (_, index) => `G1 X${index + 1} F600 S100`).join('\n');
const NOW = '2026-10-07T15:00:00.000Z';
const TERMINAL = new Set<LiveCanvasLifecycle>(['stopped', 'disconnected', 'errored', 'finished']);
let uninstall = (): void => undefined;

installResetOwnershipFixtureHooks();
beforeEach(() => useLaserStore.setState({ jobStopRequest: null, streamReset: null }));
afterEach(() => uninstall());

function canvasPlan(): CanvasMotionPlan {
  return {
    manifest: buildMotionManifest(GCODE, {
      machineKind: 'laser',
      initialPosition: { x: 0, y: 0, z: 0 },
    }),
    fingerprint: fingerprintGcode(GCODE),
    retentionKey: 'reset-terminal-outcome',
    machineKind: 'laser',
    device: DEFAULT_DEVICE_PROFILE,
    coordinateFrame: { kind: 'machine', workOffsetMm: { x: 0, y: 0, z: 0 } },
    framePerimeter: [],
    jobStart: { x: 0, y: 0 },
    approachFrom: { x: 0, y: 0 },
    capability: 'realtime',
    unavailableReason: null,
    resumed: false,
    positionEpoch: useLaserStore.getState().trustedPositionEpoch ?? 0,
  };
}

async function trackedRun() {
  const f = await connect();
  const runId = 'reset-terminal-outcome';
  await startTestLaserJob(GCODE, { runId, canvasPlan: canvasPlan() });
  const repository = new RecoveryRepository({
    backend: new MemoryRecoveryStorageBackend(),
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  expect((await repository.initialize()).ok).toBe(true);
  const artifact = await createCurrentTestExecutionArtifact({
    runId,
    gcode: GCODE,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect((await repository.activateFreshRun(runId, NOW)).ok).toBe(true);
  uninstall = installJobCheckpointTracking(() => NOW, repository);
  const terminalSight: LiveCanvasLifecycle[] = [];
  const unsubscribe = useLaserStore.subscribe((state) => {
    const lifecycle = state.liveCanvasRun?.lifecycle;
    if (lifecycle !== undefined && TERMINAL.has(lifecycle)) terminalSight.push(lifecycle);
  });
  const removeCheckpoint = uninstall;
  uninstall = () => {
    unsubscribe();
    removeCheckpoint();
  };
  f.writes.length = 0;
  return { f, repository, terminalSight };
}

function expectProvisionalFreeze(context: Awaited<ReturnType<typeof trackedRun>>): void {
  const state = useLaserStore.getState();
  expect(state.streamer?.status).toBe('errored');
  expect(state.controllerOperation).toMatchObject({ kind: 'recovery', phase: 'reset' });
  expect(state.liveCanvasRun?.lifecycle).toBe('running');
  expect(state.liveCanvasRun?.endedAtMs).toBeNull();
  expect(context.terminalSight).toEqual([]);
  expect(context.repository.getSnapshot().recoveryCapsule).toBeNull();
  expect(context.repository.getSnapshot().activeRun?.runId).toBe('reset-terminal-outcome');
  expect(context.f.writes.some((line) => line.includes('G1 X'))).toBe(false);
}

describe('actual reset outcome supplies the first terminal canvas event', () => {
  it.each(['Idle', 'Alarm', 'Sleep'])(
    'freezes host refill through %s while Abort is pending, then records its accepted stopped outcome',
    async (controllerState) => {
      const context = await trackedRun();
      context.f.controls.reset = 'hung';
      const abort = useLaserStore.getState().stopJob();
      await flush();
      expectProvisionalFreeze(context);
      context.f.emit('ok');
      context.f.controls.state = controllerState;
      context.f.status();
      await flush();
      expectProvisionalFreeze(context);

      context.f.completeReset();
      await abort;
      await flush();
      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
      expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('stopped');
      expect(context.terminalSight.every((lifecycle) => lifecycle === 'stopped')).toBe(true);
      expect(context.repository.getSnapshot().recoveryCapsule?.interruption).toMatchObject({
        kind: 'cancelled',
        message: 'Stopped by the operator (Abort).',
      });
    },
  );

  it('preserves the provisional freeze through reset acceptance until intentional Disconnect closes the port', async () => {
    const context = await trackedRun();
    context.f.controls.reset = 'hung';
    const disconnect = useLaserStore.getState().disconnect();
    await flush();
    expectProvisionalFreeze(context);
    context.f.completeReset();
    await flush();
    context.f.emit('ok');
    context.f.status();
    await flush();
    expectProvisionalFreeze(context);
    context.f.emit('Grbl 1.1f');
    await disconnect;
    await flush();

    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('disconnected');
    expect(context.terminalSight.every((lifecycle) => lifecycle === 'disconnected')).toBe(true);
    expect(context.repository.getSnapshot().recoveryCapsule?.interruption.kind).toBe('disconnect');
    expect(context.f.close).toHaveBeenCalledOnce();
  });

  it('does not revise a stopped canvas timing reason when another Abort claims a fresh reset', async () => {
    const context = await trackedRun();
    await useLaserStore.getState().stopJob();
    context.f.emit('Grbl 1.1f');
    context.f.status();
    await flush();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    const stopped = useLaserStore.getState().liveCanvasRun;
    expect(stopped?.lifecycle).toBe('stopped');
    context.f.controls.reset = 'hung';
    const repeat = useLaserStore.getState().stopJob();
    await flush();
    expect(useLaserStore.getState().liveCanvasRun).toEqual(stopped);
    context.f.emit('ok');
    context.f.status();
    await flush();
    expect(useLaserStore.getState().liveCanvasRun).toEqual(stopped);
    context.f.completeReset();
    await repeat;
    expect(useLaserStore.getState().liveCanvasRun).toEqual(stopped);
  });

  it('accepts a causal reboot before its transport promise settles without publishing a provisional fault', async () => {
    const context = await trackedRun();
    context.f.controls.reset = 'immediate-boot';
    await useLaserStore.getState().stopJob();
    await flush();
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('stopped');
    expect(context.terminalSight.every((lifecycle) => lifecycle === 'stopped')).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    context.f.completeReset();
    await flush();
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('stopped');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });

  it('publishes a real fault at the bounded reset-write timeout and cannot rewrite it after late acceptance', async () => {
    const context = await trackedRun();
    context.f.controls.reset = 'hung';
    const abort = useLaserStore.getState().stopJob();
    const rejected = expect(abort).rejects.toThrow(
      'Serial write timed out during controller reset',
    );
    await flush();
    expectProvisionalFreeze(context);
    await vi.advanceTimersByTimeAsync(500);
    await rejected;
    await flush();
    const endedAtMs = useLaserStore.getState().liveCanvasRun?.endedAtMs;
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('errored');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
    expect(context.repository.getSnapshot().recoveryCapsule?.interruption.kind).toBe(
      'write-failed',
    );
    context.f.completeReset();
    await flush();
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('errored');
    expect(useLaserStore.getState().liveCanvasRun?.endedAtMs).toBe(endedAtMs);
    expect(context.f.writes.some((line) => line.includes('G1 X'))).toBe(false);
  });

  it('records a genuine reset transport rejection as a fault rather than an accepted stop', async () => {
    const context = await trackedRun();
    context.f.controls.reset = 'rejected';
    await expect(useLaserStore.getState().stopJob()).rejects.toThrow('Reset transport rejected');
    await flush();

    expect(useLaserStore.getState().streamer?.status).toBe('errored');
    expect(useLaserStore.getState().liveCanvasRun?.lifecycle).toBe('errored');
    expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
    expect(context.repository.getSnapshot().recoveryCapsule?.interruption.kind).toBe(
      'write-failed',
    );
    expect(context.terminalSight.every((lifecycle) => lifecycle === 'errored')).toBe(true);
    expect(context.f.writes.some((line) => line.includes('G1 X'))).toBe(false);
  });
});
