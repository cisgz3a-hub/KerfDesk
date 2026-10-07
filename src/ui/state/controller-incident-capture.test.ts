import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAPTURE_IDLE,
  CAPTURE_PROGRAM,
  CAPTURE_RUN,
  adapterForCapture,
  beginCaptureTest,
  captureAdapter,
  captureController,
  connectCaptureController,
  endCaptureTest,
  retainedCapture,
} from '../../__fixtures__/controller-incident-capture';
import { incidentHistory } from '../../__fixtures__/controller-incidents';
import type { SerialPortRef } from '../../platform/types';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { flushConnect } from './laser-store-console.test-support';
import { TRANSCRIPT_MAX } from './laser-transcript';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { STREAM_STALLED_MESSAGE } from './laser-safety-notice';
import { startTestLaserJobOnClock } from './laser-test-command-control';

beforeEach(beginCaptureTest);
afterEach(endCaptureTest);

function floodControllerAcks(controller: ReturnType<typeof captureController>): void {
  for (let index = 0; index < TRANSCRIPT_MAX; index += 1) controller.connection.emitLine('ok');
}

describe('D1 substantive diagnostics on actual transport paths', () => {
  it('retains an actual safe-write rejection without releasing its ambiguous terminal-ACK reservation', async () => {
    let failing = false;
    const reason = 'D1 queued adapter write rejected';
    const controller = captureController({
      statusReply: () => CAPTURE_IDLE,
      write: async (data) => {
        if (failing && data === 'G4 P0\n') throw new Error(reason);
      },
    });
    await connectCaptureController(controller.connection);
    useLaserStore.getState().clearTranscript();
    const at = Date.now();
    failing = true;
    await expect(useLaserStore.getState().sendConsoleCommand('G4 P0')).rejects.toThrow(reason);
    failing = false;
    expect(controller.writes).toContain('G4 P0\n');
    expect(useLaserStore.getState().lastWriteError).toBe(reason);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(1);
    expect(useLaserStore.getState().pendingTransportWrites).toBe(0);
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'write-failed',
      action: 'console',
    });
    expect(retainedCapture(/D1 queued adapter write rejected/)).toEqual([
      expect.objectContaining({ at, raw: expect.stringContaining(reason) }),
    ]);
    floodControllerAcks(controller);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(retainedCapture(/D1 queued adapter write rejected/)).toHaveLength(1);
  });

  it('retains a failed port-open attempt even after a later connection succeeds', async () => {
    const reason = 'D1 adapter could not open the selected port';
    const at = Date.now();
    await useLaserStore.getState().connect(
      captureAdapter(async () => ({
        open: async () => {
          throw new Error(reason);
        },
      })),
    );
    expect(useLaserStore.getState().connection).toEqual({ kind: 'failed', error: reason });
    expect(retainedCapture(/D1 adapter could not open/)).toEqual([
      expect.objectContaining({ at, raw: expect.stringContaining(reason) }),
    ]);
    const next = captureController();
    await connectCaptureController(next.connection);
    expect(retainedCapture(/D1 adapter could not open/)).toHaveLength(1);
  });

  it('retains a detached connect-handshake write failure instead of keeping it only in log', async () => {
    const reason = 'D1 initial handshake query failed';
    let failing = true;
    let failedAt: number | null = null;
    const controller = captureController({
      write: async (data) => {
        if (failing && data === '?') {
          failedAt = Date.now();
          throw new Error(reason);
        }
      },
    });
    await useLaserStore.getState().connect(adapterForCapture(controller.connection));
    // The real handshake first listens passively; let its initial query run.
    await vi.advanceTimersByTimeAsync(251);
    await flushConnect();
    failing = false;
    expect(failedAt).not.toBeNull();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    expect(useLaserStore.getState().log).toContain(`[lf2] Controller handshake failed: ${reason}`);
    expect(retainedCapture(/D1 initial handshake query failed/)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ at: failedAt, raw: expect.stringContaining(reason) }),
      ]),
    );
  });

  it.each(['FramingError', 'ParityError'] as const)(
    'retains a real UART %s diagnostic with its original timestamp through an ACK flood',
    async (name) => {
      const controller = captureController();
      await connectCaptureController(controller.connection);
      useLaserStore.getState().clearTranscript();
      controller.emitLineError(name);
      const entry = useLaserStore
        .getState()
        .transcript.find((item) => item.raw.includes(`Serial line error (${name})`));
      expect(entry).toMatchObject({ at: Date.now(), direction: 'system' });
      floodControllerAcks(controller);
      expect(useLaserStore.getState().transcript).toHaveLength(TRANSCRIPT_MAX);
      expect(useLaserStore.getState().transcript.some((item) => item.id === entry?.id)).toBe(false);
      expect(incidentHistory()).toContainEqual(entry);
    },
  );

  it('retains the substantive ten-second silence failure after routine traffic displaces its message row', async () => {
    const controller = captureController();
    await useLaserStore
      .getState()
      .connect(adapterForCapture(controller.connection), { baudRate: 57600 });
    await vi.advanceTimersByTimeAsync(10_001);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('failed');
    const entry = useLaserStore
      .getState()
      .transcript.find((item) =>
        item.raw.includes('No controller response within 10 s. Check baud rate (57600)'),
      );
    expect(entry).toBeDefined();
    floodControllerAcks(controller);
    expect(useLaserStore.getState().transcript.some((item) => item.id === entry?.id)).toBe(false);
    expect(incidentHistory()).toContainEqual(entry);
  });

  it('retains the heartbeat containment cause after the real poll path resets and quarantines the port', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    await startTestLaserJobOnClock(CAPTURE_PROGRAM);
    controller.writes.length = 0;
    const startedAt = Date.now();
    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    await flushConnect();
    expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
    expect(useLaserStore.getState().safetyNotice).toMatchObject({
      kind: 'stream-stalled',
      message: STREAM_STALLED_MESSAGE,
    });
    expect(controller.writes).toContain('\x18');
    expect(controller.writes).toContain('M5\n');
    expect(controller.writes).toContain('M9\n');
    expect(controller.writes.some((data) => data.includes('G1 X'))).toBe(false);
    expect(controller.closeCount()).toBe(1);
    // Require the containment cause without prescribing a new context schema
    // or repeating the full SafetyNotice text in the diagnostic entry.
    const retained = retainedCapture(
      /heartbeat|active.link watchdog|not acknowledged|controller.*(?:silent|unresponsive)/i,
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]?.at).toBeGreaterThanOrEqual(startedAt);
    expect(retained[0]?.at).toBeLessThanOrEqual(Date.now());
  });

  it('control: the two-second startup grace is still listening and is not a retained failure', async () => {
    const controller = captureController();
    await useLaserStore.getState().connect(adapterForCapture(controller.connection));
    await vi.advanceTimersByTimeAsync(2_001);
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualifying');
    expect(
      useLaserStore.getState().transcript.some((entry) => entry.raw.includes('Still listening')),
    ).toBe(true);
    expect(incidentHistory()).toEqual([]);
  });

  it('control: UART notices stay throttled without changing ACK or SafetyNotice state', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    useLaserStore.getState().clearTranscript();
    const before = useLaserStore.getState();
    controller.emitLineError('FramingError');
    controller.emitLineError('ParityError');
    const after = useLaserStore.getState();
    expect(
      after.transcript.filter((entry) => entry.raw.includes('Serial line error (')),
    ).toHaveLength(1);
    expect(after.pendingUntrackedAcks).toBe(before.pendingUntrackedAcks);
    expect(after.safetyNotice).toBe(before.safetyNotice);
    expect(after.controllerQualification).toBe(before.controllerQualification);
  });

  it('control: an old UART callback cannot attribute a diagnostic to the replacement port', async () => {
    const first = captureController();
    await connectCaptureController(first.connection);
    const old = first.retiredErrors[0];
    expect(old).toBeTypeOf('function');
    const next = captureController();
    await connectCaptureController(next.connection);
    const before = useLaserStore.getState();
    old?.('D1 stale UART owner');
    expect(useLaserStore.getState()).toBe(before);
    expect(retainedCapture(/D1 stale UART owner/)).toEqual([]);
  });

  it('control: a stale rejected Connect attempt does not overwrite or archive a replacement session', async () => {
    let rejectOld: (error: Error) => void = () => undefined;
    const pending = new Promise<SerialPortRef | null>((_resolve, reject) => {
      rejectOld = reject;
    });
    const connecting = useLaserStore.getState().connect(captureAdapter(async () => pending));
    await flushConnect();
    const next = captureController();
    await connectCaptureController(next.connection);
    const before = useLaserStore.getState();
    rejectOld(new Error('D1 stale picker failure'));
    await connecting;
    expect(useLaserStore.getState()).toBe(before);
    expect(retainedCapture(/D1 stale picker failure/)).toEqual([]);
  });

  it('control: a late old safe-write rejection neither changes the new ACK fence nor creates a current incident', async () => {
    let rejectOld: (error: Error) => void = () => undefined;
    const pending = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    const refs: SafeWriteRefs = {
      connection: {
        write: async () => pending,
        onLine: () => () => undefined,
        onClose: () => () => undefined,
        close: async () => undefined,
      },
      driver: grblDriver,
      nextTranscriptId: 1,
      writeEpoch: 0,
    };
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);
    const operation = write('G1 X1\n', 'frame', 'motion');
    const outcome = expect(operation).rejects.toThrow('D1 obsolete write failed');
    refs.writeEpoch = 1;
    useLaserStore.setState({ pendingTransportWrites: 3, pendingUntrackedAcks: 2 });
    const before = useLaserStore.getState();
    rejectOld(new Error('D1 obsolete write failed'));
    await outcome;
    expect(useLaserStore.getState()).toBe(before);
    expect(retainedCapture(/D1 obsolete write failed/)).toEqual([]);
  });

  it('control: explicit Disconnect never creates an unexpected-disconnect or heartbeat incident', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    await useLaserStore.getState().disconnect();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(incidentHistory()).toEqual([]);
    expect(controller.closeCount()).toBe(1);
  });

  it('control: fresh active-stream responses preserve streaming and do not manufacture heartbeat incidents', async () => {
    const controller = captureController({
      statusReply: () =>
        useLaserStore.getState().streamer?.status === 'streaming' ? CAPTURE_RUN : CAPTURE_IDLE,
    });
    await connectCaptureController(controller.connection);
    await startTestLaserJobOnClock(CAPTURE_PROGRAM);
    controller.writes.length = 0;
    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(controller.writes).toContain('?');
    expect(controller.writes).not.toContain('\x18');
    expect(incidentHistory()).toEqual([]);
  });
});
