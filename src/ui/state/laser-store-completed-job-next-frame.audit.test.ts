import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer, idleCollector, step } from '../../core/controllers/grbl';
import { createProject } from '../../core/scene';
import {
  cancelControllerLifecycleRefs,
  consumeControllerCommandResponse,
  observeControllerIdleWait,
} from './laser-interactive-command';
import { laserCountdownTestHandoff } from './laser-countdown-test-handoff';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { handleLine } from './laser-line-handler';
import { beginPostJobSettle } from './laser-post-job-settle';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  connectWith,
  type FakeConnection,
  framedRunCandidate,
  makeConnection,
} from './laser-store-motion-operation.test-support';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { startTestLaserJobOnClock } from './laser-test-command-control';
import { useStore } from './store';

const JOB = 'G21\nG90\nM3 S0\nG1 X10 F600 S100\nM5\n';
const FINAL_IDLE = '<Idle|MPos:10.000,20.000,0.000|WCO:0.000,0.000,0.000|FS:0,0>';
const NEW_BOUNDS = { minX: 40, minY: 60, maxX: 80, maxY: 100 };

async function flush(): Promise<void> {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

async function readyConnection(writes: string[]): Promise<FakeConnection> {
  const connection = makeConnection(
    async (data) => {
      writes.push(data);
    },
    undefined,
    { autoAckStartFence: true },
  );
  await connectWith(connection);
  await settleTestGrblHandshake();
  connection.emitLine(FINAL_IDLE);
  await flush();
  writes.length = 0;
  return connection;
}

async function acknowledgeJob(connection: FakeConnection): Promise<void> {
  await startTestLaserJobOnClock(JOB, {
    ...laserCountdownTestHandoff({
      gcode: JOB,
      retentionKey: 'finished-job-next-frame-audit',
      capability: 'realtime',
    }),
  });
  for (let line = 0; line < 5; line += 1) connection.emitLine('ok');
  await flush();
  expect(useLaserStore.getState().controllerOperation).toMatchObject({
    kind: 'post-job-settle',
    phase: 'dwell',
  });
}

async function finishJob(connection: FakeConnection): Promise<void> {
  await acknowledgeJob(connection);
  connection.emitLine('ok');
  await flush();
  connection.emitLine(FINAL_IDLE);
  await flush();
  connection.emitLine(FINAL_IDLE);
  await flush();
  expect(useLaserStore.getState().streamer).toBeNull();
  expect(useLaserStore.getState().controllerOperation).toBeNull();
}

function nextCandidate() {
  return {
    ...framedRunCandidate(),
    executionSignature: 'new-job-after-completed-run',
    frameVerification: {
      boundsSignature: '40,60,80,100',
      wco: { x: 0, y: 0, z: 0 },
      workOriginActive: false,
    },
    returnToWorkPosition: { x: 10, y: 20 },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
  vi.restoreAllMocks();
});

describe('finished job to the next physical Frame', () => {
  it('frames the new bounds and current return point without dismissing the old run display', async () => {
    const writes: string[] = [];
    const connection = await readyConnection(writes);
    await finishJob(connection);
    const finishedDisplay = useLaserStore.getState().liveCanvasRun;
    expect(finishedDisplay?.timing?.kind).toBe('complete');
    writes.length = 0;
    const candidate = nextCandidate();

    await useLaserStore.getState().frame(NEW_BOUNDS, 1000, candidate);
    await acknowledgeFrameToolOffPrelude(connection);
    for (let leg = 0; leg < 6; leg += 1) await acknowledgeAndSettleFrameLeg(connection);
    await acknowledgeMotionSettlement(connection, FINAL_IDLE);

    expect(writes.filter((line) => line.startsWith('$J='))).toEqual([
      '$J=G90 G21 X40.000 Y60.000 F1000\n',
      '$J=G90 G21 X80.000 Y60.000 F1000\n',
      '$J=G90 G21 X80.000 Y100.000 F1000\n',
      '$J=G90 G21 X40.000 Y100.000 F1000\n',
      '$J=G90 G21 X40.000 Y60.000 F1000\n',
      '$J=G90 G21 X10.000 Y20.000 F1000\n',
    ]);
    expect(useLaserStore.getState().motionOperation).toBeNull();
    expect(useLaserStore.getState().framedRun?.candidate).toBe(candidate);
    expect(useLaserStore.getState().liveCanvasRun?.plan).toBe(finishedDisplay?.plan);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
  });

  it('waits for actual completion rather than allowing a new Frame after only the final ACK', async () => {
    const writes: string[] = [];
    const connection = await readyConnection(writes);
    await acknowledgeJob(connection);
    writes.length = 0;
    await expect(useLaserStore.getState().frame(NEW_BOUNDS, 1000)).rejects.toThrow(
      /job is active/i,
    );
    expect(writes).toEqual([]);
    connection.emitLine('ok');
    await flush();
    connection.emitLine(FINAL_IDLE);
    await flush();
    await expect(useLaserStore.getState().frame(NEW_BOUNDS, 1000)).rejects.toThrow(
      /job is active/i,
    );
    expect(writes).toEqual([]);

    connection.emitLine(FINAL_IDLE);
    await flush();
    await useLaserStore.getState().frame(NEW_BOUNDS, 1000);
    expect(writes).toContain('M5\n');
    expect(useLaserStore.getState().motionOperation?.kind).toBe('frame');
  });

  it('clears the lock after a refused completion marker and a fresh Idle', async () => {
    const writes: string[] = [];
    const connection = await readyConnection(writes);
    await acknowledgeJob(connection);
    connection.emitLine('error:33');
    await flush();
    expect(useLaserStore.getState().liveCanvasRun?.timing).toEqual({
      kind: 'unavailable',
      reason: 'controller completion settlement could not be confirmed',
    });
    connection.emitLine(FINAL_IDLE);
    await flush();
    expect(useLaserStore.getState().streamer).toBeNull();
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('unavailable');
    useLaserStore.getState().clearSafetyNotice();
    writes.length = 0;

    await useLaserStore.getState().frame(NEW_BOUNDS, 1000);
    expect(writes).toContain('M5\n');
  });
});

describe('post-job settlement continuation ownership', () => {
  it.each(['operation owner', 'program backing array'] as const)(
    'rejects an injected replacement %s even when session and run epochs are unchanged',
    async (replacement) => {
      const { get, set, refs } = makeLineHandlerHarness();
      const oldStreamer = { ...createStreamer(JOB), status: 'done' as const };
      set({ streamer: oldStreamer });
      beginPostJobSettle(set, get, refs, async () => undefined);
      await flush();
      const oldOperation = get().controllerOperation;
      consumeControllerCommandResponse(refs, grblDriver.classifyLine('ok'), 'ok');

      // Defensive owner invariants, explicitly not a normal user sequence.
      const replacementOperation =
        replacement === 'operation owner'
          ? ({ kind: 'post-job-settle', phase: 'dwell', idleReports: 0 } as const)
          : oldOperation;
      const replacementStreamer =
        replacement === 'program backing array'
          ? { ...createStreamer('G1 X999 F600\n'), status: 'done' as const }
          : oldStreamer;
      set({ controllerOperation: replacementOperation, streamer: replacementStreamer });
      await flush();

      expect(get().controllerOperation).toBe(replacementOperation);
      expect(get().streamer).toBe(replacementStreamer);
      expect(refs.controllerIdleWait).toBeNull();
      cancelControllerLifecycleRefs(refs, 'Audit fixture cleanup.');
      await flush();
    },
  );

  it('does not recreate an old Idle waiter when a reboot banner follows the marker ACK', async () => {
    const { get, set, refs } = makeLineHandlerHarness();
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
    const write = vi.fn(async () => undefined);
    // Actual receive pipeline, without directly replacing state: a controller
    // delivers its final ACKs, then its settle ACK and a reboot banner before
    // the previous ACK's Promise continuation can resume.
    set({ streamer: step(createStreamer(JOB)).state });
    for (let line = 0; line < 5; line += 1) handleLine(set, get, refs, write, 'ok');
    await flush();
    expect(get().controllerOperation).toMatchObject({ phase: 'dwell' });
    const oldSession = get().controllerSessionEpoch;

    handleLine(set, get, refs, write, 'ok');
    handleLine(set, get, refs, write, 'Grbl 1.1f');
    await flush();

    expect(get().controllerSessionEpoch).toBe(oldSession + 1);
    expect(get().controllerOperation).toBeNull();
    expect(refs.controllerIdleWait).toBeNull();
    cancelControllerLifecycleRefs(refs, 'Audit fixture cleanup.');
    await flush();
  });

  it.each(['marker ACK', 'final Idle', 'cancellation'] as const)(
    'does not mutate a replacement run after the older %s has settled',
    async (boundary) => {
      const { get, set, refs } = makeLineHandlerHarness();
      const oldStreamer = { ...createStreamer(JOB), status: 'done' as const };
      set({ streamer: oldStreamer, streamerEpoch: 1, activeRunId: 'older-run' });
      beginPostJobSettle(set, get, refs, async () => undefined);
      await flush();

      if (boundary === 'cancellation') {
        cancelControllerLifecycleRefs(refs, 'Old controller disconnected.');
      } else {
        consumeControllerCommandResponse(refs, grblDriver.classifyLine('ok'), 'ok');
        if (boundary === 'final Idle') {
          await flush();
          const status = grblDriver.classifyLine(FINAL_IDLE);
          if (status.kind !== 'status') throw new Error('Expected the GRBL Idle fixture.');
          observeControllerIdleWait(set, refs, status.report);
          observeControllerIdleWait(set, refs, status.report);
        }
      }

      // A reset/reconnect or another run owns state before the older Promise's
      // microtask resumes. Its same-kind operation is a new owner, not a phase
      // continuation of the previous run.
      const replacementStreamer = { ...createStreamer(JOB), status: 'done' as const };
      const replacementOperation = {
        kind: 'post-job-settle',
        phase: 'dwell',
        idleReports: 0,
      } as const;
      refs.writeEpoch = (refs.writeEpoch ?? 0) + 1;
      set({
        controllerSessionEpoch: get().controllerSessionEpoch + 1,
        streamerEpoch: 2,
        activeRunId: 'replacement-run',
        streamer: replacementStreamer,
        controllerOperation: replacementOperation,
      });
      await flush();

      expect(get().controllerOperation).toBe(replacementOperation);
      expect(get().streamer).toBe(replacementStreamer);
      expect(get().safetyNotice).toBeNull();
      expect(get().lastWriteError).toBeNull();
      expect(refs.controllerIdleWait).toBeNull();
      cancelControllerLifecycleRefs(refs, 'Audit fixture cleanup.');
      await flush();
    },
  );
});
