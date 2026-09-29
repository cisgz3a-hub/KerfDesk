import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { desktopCloseController } from './desktop-close-runtime';

const initialLaser = useLaserStore.getState();

afterEach(() => {
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
});

function installOperation(kind: 'frame' | 'jog' | 'home' | 'probe') {
  if (kind === 'frame' || kind === 'jog') {
    useLaserStore.setState({ motionOperation: startMotionOperation(kind) });
  } else if (kind === 'home') {
    useLaserStore.setState({
      controllerOperation: { kind, phase: 'command', idleReports: 0, operationId: 1 },
    });
  } else {
    useLaserStore.setState({
      controllerOperation: {
        kind,
        phase: 'sequence',
        idleReports: 0,
        transactionId: 1,
        affectsXy: false,
      },
    });
  }
}

describe('desktop close during owned machine motion', () => {
  it.each(['frame', 'jog', 'home', 'probe'] as const)(
    'awaits Abort during %s even when there is no job streamer',
    async (kind) => {
      let finish: () => void = () => undefined;
      const stop = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
      useLaserStore.setState({ streamer: null, fireActive: false, stopJob: stop });
      installOperation(kind);

      const prepared = desktopCloseController.prepare(1);
      const settled = vi.fn();
      void prepared.then(settled);
      expect(stop).toHaveBeenCalledWith('app-closing');
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      // A completed software stop may leave the same operation waiting for
      // controller settlement. It must not require a fabricated physical proof.
      finish();
      await expect(prepared).resolves.toEqual({ status: 'ready', dirty: false });
      expect(desktopCloseController.approve(1)).toEqual({ status: 'approved' });
    },
  );

  it('does not stop a connection handshake with no machine motion', async () => {
    const stop = vi.fn(async () => undefined);
    useLaserStore.setState({
      streamer: null,
      stopJob: stop,
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
    });
    await expect(desktopCloseController.prepare(1)).resolves.toEqual({
      status: 'ready',
      dirty: false,
    });
    expect(stop).not.toHaveBeenCalled();
  });

  it('invalidates idle approval when a new Frame starts without changing streamerEpoch', async () => {
    await desktopCloseController.prepare(1);
    installOperation('frame');
    expect(desktopCloseController.approve(1)).toEqual({ status: 'retry' });
  });

  it('does not approve a replacement motion that appears during the stop', async () => {
    let finish: () => void = () => undefined;
    useLaserStore.setState({
      stopJob: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    installOperation('frame');
    const prepared = desktopCloseController.prepare(1);
    const settled = vi.fn();
    void prepared.then(settled);
    installOperation('jog');
    finish();
    await vi.waitFor(() => expect(desktopCloseController.getNotice()?.kind).toBe('failed'));
    expect(settled).not.toHaveBeenCalled();
    desktopCloseController.keepOpen();
    await expect(prepared).resolves.toEqual({ status: 'cancelled' });
  });

  it('keeps controls available when Abort fails with a motion owner remaining', async () => {
    useLaserStore.setState({
      stopJob: vi.fn(async () => Promise.reject(new Error('write failed'))),
    });
    installOperation('home');
    const prepared = desktopCloseController.prepare(1);
    await vi.waitFor(() => expect(desktopCloseController.getNotice()?.kind).toBe('failed'));
    desktopCloseController.keepOpen();
    await expect(prepared).resolves.toEqual({ status: 'cancelled' });
  });

  it('leaves a fully idle controller alone', async () => {
    const stop = vi.fn(async () => undefined);
    useLaserStore.setState({ stopJob: stop });
    await expect(desktopCloseController.prepare(1)).resolves.toEqual({
      status: 'ready',
      dirty: false,
    });
    expect(desktopCloseController.approve(1)).toEqual({ status: 'approved' });
    expect(stop).not.toHaveBeenCalled();
  });

  it('joins repeated close requests to Fire-off then one Abort for a job and motion owner', async () => {
    let releaseFire: () => void = () => undefined;
    const fire = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseFire = () => {
            useLaserStore.setState({ fireActive: false });
            resolve();
          };
        }),
    );
    const stop = vi.fn(async () => useLaserStore.setState({ streamer: null }));
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1')).state,
      fireActive: true,
      setFireActive: fire,
      stopJob: stop,
    });
    installOperation('frame');
    const prepared = desktopCloseController.prepare(1);
    const repeated = desktopCloseController.prepare(2);
    expect(prepared).toBe(repeated);
    expect(fire).toHaveBeenCalledWith(false);
    expect(stop).not.toHaveBeenCalled();
    releaseFire();
    await expect(prepared).resolves.toEqual({ status: 'ready', dirty: false });
    expect(stop).toHaveBeenCalledExactlyOnceWith('app-closing');
    expect(desktopCloseController.approve(1)).toEqual({ status: 'approved' });
  });

  it('keeps Home ownership across phase updates during Abort', async () => {
    let finish: () => void = () => undefined;
    useLaserStore.setState({
      stopJob: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    installOperation('home');
    const prepared = desktopCloseController.prepare(1);
    useLaserStore.setState({
      controllerOperation: { kind: 'home', phase: 'settling', idleReports: 1, operationId: 1 },
    });
    finish();
    await expect(prepared).resolves.toMatchObject({ status: 'ready' });
    expect(desktopCloseController.approve(1)).toEqual({ status: 'approved' });
  });

  it('does not acknowledge an old stop warning for a newly started motion', async () => {
    useLaserStore.setState({
      safetyNotice: { kind: 'write-failed', action: 'stop', message: 'Abort was not confirmed.' },
    });
    const prepared = desktopCloseController.prepare(1);
    const notice = desktopCloseController.getNotice();
    expect(notice?.kind).toBe('unconfirmed');
    installOperation('frame');
    if (notice === null) throw new Error('expected the stop warning');
    desktopCloseController.acknowledgeWarning(notice);
    expect(desktopCloseController.getNotice()?.kind).toBe('failed');
    desktopCloseController.keepOpen();
    await expect(prepared).resolves.toEqual({ status: 'cancelled' });
  });
});
