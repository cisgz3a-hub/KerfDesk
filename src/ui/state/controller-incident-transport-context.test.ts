import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import {
  beginCaptureTest,
  captureAdapter,
  captureController,
  CAPTURE_PROGRAM,
  connectCaptureController,
  endCaptureTest,
} from '../../__fixtures__/controller-incident-capture';
import { incidentHistory } from '../../__fixtures__/controller-incidents';
import { useLaserStore } from './laser-store';
import { observeSerialLineErrors } from './laser-serial-line-errors';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { controllerIncidentContext } from './controller-incident-context';
import { ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS } from './laser-stream-heartbeat';
import { startTestLaserJobOnClock } from './laser-test-command-control';
import { flushConnect } from './laser-store-console.test-support';

describe('D1 owned transport facts and retired-close boundaries', () => {
  beforeEach(beginCaptureTest);
  afterEach(endCaptureTest);

  it('retains attempted baud and allowlisted USB facts from a failed open without publishing a connected port', async () => {
    const info = { usbVendorId: 1234, usbProductId: 5678, privatePortPath: 'D1-private-port-path' };
    const adapter = captureAdapter(async () => ({
      info,
      open: async (options) => {
        expect(options.baudRate).toBe(57600);
        throw new Error('D1 owned open failure with USB facts');
      },
    }));
    await useLaserStore.getState().connect(adapter, { baudRate: 57600 });
    const retained = incidentHistory().filter((entry) =>
      entry.raw.includes('D1 owned open failure'),
    );
    expect(retained).toHaveLength(1);
    expect(retained[0]?.incidentContext?.controller).toMatchObject({
      connection: 'connecting',
      baudRate: 57600,
      usb: { usbVendorId: 1234, usbProductId: 5678 },
    });
    expect(JSON.stringify(retained[0]?.incidentContext)).not.toContain('D1-private-port-path');
    info.usbVendorId = 999;
    expect(retained[0]?.incidentContext?.controller.usb?.usbVendorId).toBe(1234);
    expect(useLaserStore.getState()).toMatchObject({
      connection: { kind: 'failed' },
      connectedBaudRate: null,
      serialPortInfo: null,
    });
  });

  it('captures pending job refills from the actual local safe-write ledger, alongside store writes', async () => {
    let finishWrite: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const controller = captureController({ write: async () => pending });
    const refs: SafeWriteRefs = {
      connection: controller.connection,
      driver: grblDriver,
      nextTranscriptId: 1,
      writeEpoch: 41,
    };
    useLaserStore.setState({
      connection: { kind: 'connected' },
      controllerSessionEpoch: 7,
      pendingTransportWrites: 2,
    });
    observeSerialLineErrors(
      useLaserStore.setState,
      useLaserStore.getState,
      refs,
      controller.connection,
    );
    const write = createSafeWrite(useLaserStore.setState, useLaserStore.getState, refs);
    const sending = write('G1 X123 S100\n', undefined, 'job');
    expect(refs.jobTransportWrites).toEqual({ epoch: 41, count: 1 });
    controller.emitLineError('FramingError');
    const incident = incidentHistory().find((entry) => entry.raw.includes('FramingError'));
    expect(incident?.incidentContext?.run).toMatchObject({
      pendingTransportWrites: 3,
      storePendingTransportWrites: 2,
      refillPendingTransportWrites: 1,
    });
    expect(useLaserStore.getState().pendingTransportWrites).toBe(2);
    refs.writeEpoch = 42;
    const outcome = expect(sending).rejects.toThrow('Serial session changed');
    finishWrite();
    await outcome;
    expect(incident?.incidentContext?.run.refillPendingTransportWrites).toBe(1);
    expect(incidentHistory()).toHaveLength(1);
  });

  it('control: a stale refill ledger and unrelated global store do not become current pending writes', () => {
    useLaserStore.setState({ pendingTransportWrites: 3 });
    const snapshot = controllerIncidentContext(useLaserStore.getState(), {
      writeEpoch: 42,
      jobTransportWrites: { epoch: 41, count: 99 },
    });
    expect(snapshot?.run).toMatchObject({
      pendingTransportWrites: 3,
      storePendingTransportWrites: 3,
      refillPendingTransportWrites: 0,
    });
    expect(
      controllerIncidentContext(useLaserStore.getState())?.run.refillPendingTransportWrites,
    ).toBe(0);
  });

  it('retains a containment-close rejection with the last owned controller facts before teardown', async () => {
    const controller = captureController();
    await connectCaptureController(controller.connection);
    useLaserStore.setState({ controllerBuildInfoRawLines: ['[VER:contained-controller]'] });
    vi.spyOn(controller.connection, 'close').mockImplementation(async () => {
      throw new Error('D1 owned contained close rejected');
    });
    await startTestLaserJobOnClock(CAPTURE_PROGRAM);
    const ownedBaud = useLaserStore.getState().connectedBaudRate;
    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    await flushConnect();
    const failures = incidentHistory().filter((entry) =>
      entry.raw.includes('D1 owned contained close rejected'),
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]?.kind).toBe('disconnect');
    expect(failures[0]?.incidentContext?.controller).toMatchObject({
      connection: 'connected',
      baudRate: ownedBaud,
      selectedKind: 'grbl-v1.1',
    });
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().connectedBaudRate).toBeNull();
    expect(controller.connection.close).toHaveBeenCalledOnce();
    expect(incidentHistory().some((entry) => entry.raw.includes('active-link watchdog'))).toBe(
      true,
    );
  });

  it('control: a delayed contained-close rejection cannot append facts to a newer connection', async () => {
    const first = captureController();
    await connectCaptureController(first.connection);
    let rejectClose: (error: Error) => void = () => undefined;
    const closing = new Promise<void>((_resolve, reject) => {
      rejectClose = reject;
    });
    vi.spyOn(first.connection, 'close').mockImplementation(async () => closing);
    await startTestLaserJobOnClock(CAPTURE_PROGRAM);
    await vi.advanceTimersByTimeAsync(ACTIVE_STREAM_HEARTBEAT_TIMEOUT_MS + 500);
    expect(first.connection.close).toHaveBeenCalledOnce();
    const next = captureController();
    await connectCaptureController(next.connection);
    const before = useLaserStore.getState();
    rejectClose(new Error('D1 retired contained close rejected'));
    await flushConnect();
    expect(useLaserStore.getState()).toBe(before);
    expect(
      incidentHistory().some((entry) => entry.raw.includes('D1 retired contained close rejected')),
    ).toBe(false);
    expect(next.closeCount()).toBe(0);
  });
});
