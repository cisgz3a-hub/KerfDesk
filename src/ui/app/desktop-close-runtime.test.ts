import { afterEach, describe, expect, it, vi } from 'vitest';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { createStreamer, parseStatusReport, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { installUnloadStop } from './use-unload-stop';
import { installUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { desktopCloseController } from './desktop-close-runtime';
import { useToastStore } from '../state/toast-store';
import { useFramePreparationStore } from '../state/frame-preparation-store';
import { statusPositionPatch } from '../state/laser-status-position';
import {
  beginJobTransportWrite,
  bindLiveJobTransportLedger,
  settleJobTransportWrite,
} from '../state/laser-job-transport-ledger';

const initialLaser = useLaserStore.getState();
const initialScene = useStore.getState();
let dispose = () => undefined;

function install() {
  const unload = installUnloadStop(window);
  const unsaved = installUnsavedChangesGuard(window);
  dispose = () => {
    unload();
    unsaved();
  };
}

function request(
  operation: 'prepare' | 'prepare-update' | 'approve' | 'cancel',
  id = 1,
): Promise<unknown> {
  const result: unknown = window.eval(rendererCloseRequestScript(operation, id));
  return Promise.resolve(result);
}

afterEach(() => {
  dispose();
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
  useStore.setState(initialScene);
  useToastStore.setState({ toasts: [] });
  useFramePreparationStore.setState({ pending: false });
});

describe('main-to-renderer fixed close protocol with actual unload hooks', () => {
  it('keeps a running job or latched Fire open for update without sending Stop or Fire-off', async () => {
    const stopJob = vi.fn(async () => undefined);
    const setFireActive = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1')).state,
      stopJob,
      setFireActive,
    });
    install();
    expect(await request('prepare-update')).toEqual({ status: 'cancelled' });
    useLaserStore.setState({ streamer: null, fireActive: true });
    expect(await request('prepare-update', 2)).toEqual({ status: 'cancelled' });
    expect(stopJob).not.toHaveBeenCalled();
    expect(setFireActive).not.toHaveBeenCalled();
    expect(desktopCloseController.ownsUnload).toBe(false);
    expect(
      useToastStore
        .getState()
        .toasts.some((toast) => toast.message.includes('KerfDesk stays open')),
    ).toBe(true);
  });
  it('keeps Frame preparation open and rechecks it after an idle update approval', async () => {
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ streamer: null, fireActive: false, stopJob });
    install();
    useFramePreparationStore.setState({ pending: true });
    expect(await request('prepare-update')).toEqual({ status: 'cancelled' });
    useFramePreparationStore.setState({ pending: false });
    expect(await request('prepare-update', 2)).toMatchObject({ status: 'ready' });
    useFramePreparationStore.setState({ pending: true });
    expect(await request('approve', 2)).toEqual({ status: 'retry' });
    expect(stopJob).not.toHaveBeenCalled();
  });
  it('retains intermittent spindle observations until a fresh all-off report', async () => {
    const stopJob = vi.fn(async () => undefined);
    const setFireActive = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      streamer: null,
      fireActive: false,
      accessoryCache: null,
      stopJob,
      setFireActive,
    });
    const receive = (wire: string) => {
      const report = parseStatusReport(wire);
      if (report === null) throw new Error('Invalid status fixture');
      useLaserStore.setState(statusPositionPatch(useLaserStore.getState(), report));
    };
    install();
    receive('<Idle|MPos:0,0,0|FS:0,12000|Ov:100,100,100|A:S>');
    receive('<Idle|MPos:0,0,0|FS:0,12000>');
    expect(useLaserStore.getState().statusReport?.accessories).toBeNull();
    expect(useLaserStore.getState().accessoryCache?.spindleCw).toBe(true);
    expect(await request('prepare-update')).toEqual({ status: 'cancelled' });
    receive('<Idle|MPos:0,0,0|FS:0,0|Ov:100,100,100>');
    expect(await request('prepare-update', 2)).toMatchObject({ status: 'ready' });
    receive('<Idle|MPos:0,0,0|FS:0,12000|Ov:100,100,100|A:S>');
    receive('<Idle|MPos:0,0,0|FS:0,12000>');
    expect(await request('approve', 2)).toEqual({ status: 'retry' });
    expect(stopJob).not.toHaveBeenCalled();
    expect(setFireActive).not.toHaveBeenCalled();
  });
  it('keeps an off-store job refill open until its transport write settles', async () => {
    const refs = { writeEpoch: 3 };
    bindLiveJobTransportLedger(refs);
    const epoch = beginJobTransportWrite(refs);
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: null,
      fireActive: false,
      pendingTransportWrites: 0,
      pendingUntrackedAcks: 0,
      stopJob,
    });
    install();
    try {
      expect(await request('prepare-update')).toEqual({ status: 'cancelled' });
      settleJobTransportWrite(refs, epoch);
      expect(await request('prepare-update', 2)).toMatchObject({ status: 'ready' });
      const nextEpoch = beginJobTransportWrite(refs);
      expect(await request('approve', 2)).toEqual({ status: 'retry' });
      settleJobTransportWrite(refs, nextEpoch);
      expect(stopJob).not.toHaveBeenCalled();
    } finally {
      settleJobTransportWrite(refs, epoch);
    }
  });
  it('awaits active handoff, retains dirty confirmation, and never repeats the stop at unload', async () => {
    let complete: () => void = () => undefined;
    const stop = vi.fn(() => new Promise<void>((resolve) => (complete = resolve)));
    useStore.setState({ dirty: true });
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1')).state, stopJob: stop });
    install();
    const pending = request('prepare');
    expect(stop).toHaveBeenCalledTimes(1);
    // Recovery must record this as the app closing, not an operator Abort.
    expect(stop).toHaveBeenCalledWith('app-closing');
    const early = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(early);
    window.dispatchEvent(new Event('pagehide'));
    expect(early.defaultPrevented).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
    useLaserStore.setState({ streamer: null });
    complete();
    expect(await pending).toEqual({ status: 'ready', dirty: true });
    expect(await request('approve')).toEqual({ status: 'approved' });
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    window.dispatchEvent(new Event('pagehide'));
    expect(leaving.defaultPrevented).toBe(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('keeps the existing idle browser dirty guard after a desktop Stay decision', async () => {
    const stop = vi.fn(async () => undefined);
    useStore.setState({ dirty: true });
    useLaserStore.setState({ streamer: null, stopJob: stop });
    install();
    expect(await request('prepare')).toEqual({ status: 'ready', dirty: true });
    await request('cancel');
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stop).not.toHaveBeenCalled();
  });

  it('only retains close acknowledgement for an actual stop warning', async () => {
    install();
    useLaserStore.setState({
      streamer: null,
      safetyNotice: { kind: 'frame-limit', message: 'Frame warning' },
    });
    expect(await request('prepare')).toMatchObject({ status: 'ready' });
    await request('cancel');
    useLaserStore.setState({
      safetyNotice: { kind: 'write-failed', action: 'stop', message: 'Abort was not written' },
    });
    const pending = request('prepare', 2);
    expect(desktopCloseController.getNotice()).toEqual({
      kind: 'unconfirmed',
      message: 'Abort was not written',
      retry: false,
    });
    desktopCloseController.keepOpen();
    expect(await pending).toEqual({ status: 'cancelled' });
  });

  it('reports unavailable if the renderer has not installed its close receiver', async () => {
    expect(await request('prepare')).toEqual({ status: 'unavailable' });
  });

  it('invalidates approval for a different already-dirty project or document epoch', async () => {
    install();
    useStore.setState({ dirty: true });
    useLaserStore.setState({ streamer: null, safetyNotice: null });
    await request('prepare', 10);
    useStore.setState({ project: { ...useStore.getState().project } });
    expect(await request('approve', 10)).toEqual({ status: 'retry' });
    await request('prepare', 11);
    expect(await request('approve', 11)).toEqual({ status: 'approved' });
    useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('desktop close runtime with Fire latched (audit electron-native-3)', () => {
  it('writes the Fire release, not an Abort, when no job runs', async () => {
    const setFireActive = vi.fn(async () => {
      useLaserStore.setState({ fireActive: false });
    });
    const stopJob = vi.fn(async () => undefined);
    useLaserStore.setState({ fireActive: true, setFireActive, stopJob });
    install();

    await expect(request('prepare')).resolves.toEqual({ status: 'ready', dirty: false });

    expect(setFireActive).toHaveBeenCalledWith(false);
    expect(stopJob).not.toHaveBeenCalled();
  });
});
