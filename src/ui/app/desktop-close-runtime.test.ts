import { afterEach, describe, expect, it, vi } from 'vitest';
import { rendererCloseRequestScript } from '../../../electron/renderer-close-request';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { installUnloadStop } from './use-unload-stop';
import { installUnsavedChangesGuard } from './use-unsaved-changes-guard';
import { desktopCloseController } from './desktop-close-runtime';

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

function request(operation: 'prepare' | 'approve' | 'cancel', id = 1): Promise<unknown> {
  const result: unknown = window.eval(rendererCloseRequestScript(operation, id));
  return Promise.resolve(result);
}

afterEach(() => {
  dispose();
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
  useStore.setState(initialScene);
});

describe('main-to-renderer fixed close protocol with actual unload hooks', () => {
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
