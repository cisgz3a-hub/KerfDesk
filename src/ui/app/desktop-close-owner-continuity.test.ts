import { afterEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter, SerialConnection } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { desktopCloseController } from './desktop-close-runtime';
import {
  continueControllerOperation,
  controllerOperationOwner,
  type LaserControllerOperation,
} from '../state/laser-controller-operation';

const initialLaser = useLaserStore.getState();

async function flush() {
  for (let i = 0; i < 15; i += 1) await Promise.resolve();
}

afterEach(async () => {
  desktopCloseController.keepOpen();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState(initialLaser);
});

function recoveryConnection() {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string) => {
    for (const handler of lineHandlers) handler(line);
  };
  let resetHeld = false;
  let resolveReset: () => void = () => undefined;
  const write = vi.fn(async (line: string) => {
    if (resetHeld && line === '\x18') {
      await new Promise<void>((resolve) => {
        resolveReset = resolve;
      });
    }
  });
  const connection: SerialConnection = {
    write,
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  const adapter: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: {
      isSupported: () => true,
      requestPort: async () => ({ open: async () => connection }),
    },
  };
  return {
    adapter,
    write,
    emitLine,
    holdReset: () => {
      resetHeld = true;
    },
    finishReset: () => {
      resetHeld = false;
      resolveReset();
    },
  };
}

async function settleWakeBeforeTeardown(
  connection: ReturnType<typeof recoveryConnection>,
  wake: Promise<unknown>,
) {
  connection.finishReset();
  connection.emitLine('Grbl 1.1f');
  await flush();
  connection.emitLine('ok');
  connection.emitLine('ok');
  connection.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await wake.catch(() => undefined);
}

it('real Abort does not treat a recovery status update as a replacement owner', async () => {
  const f = recoveryConnection();
  await useLaserStore.getState().connect(f.adapter);
  f.emitLine('Grbl 1.1f');
  f.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  f.emitLine('ok');
  await flush();
  const wake = useLaserStore.getState().wakeController();
  void wake.catch(() => undefined);
  let recoverySettled = false;
  try {
    await flush();
    const ownerBefore = useLaserStore.getState().controllerOperation;
    expect(ownerBefore).toMatchObject({ kind: 'recovery', phase: 'awaiting-idle' });
    const privateOwner = controllerOperationOwner(ownerBefore!);
    f.holdReset();
    const prepared = desktopCloseController.prepare(80);
    const preparedReply = vi.fn();
    void prepared.then(preparedReply);
    expect(f.write).toHaveBeenLastCalledWith('\x18');
    f.emitLine('<Run|MPos:0.000,0.000,0.000|FS:0,0>');
    const continued = useLaserStore.getState().controllerOperation;
    expect(continued).toMatchObject({ kind: 'recovery', phase: 'reset', idleReports: 0 });
    expect(controllerOperationOwner(continued!)).toBe(privateOwner);
    expect(continued).not.toBe(ownerBefore);
    f.finishReset();
    await flush();
    const actualNotice = desktopCloseController.getNotice();
    const approval = desktopCloseController.approve(80);
    desktopCloseController.keepOpen();
    await prepared;
    expect(actualNotice?.kind).not.toBe('failed');
    expect(preparedReply).toHaveBeenCalledExactlyOnceWith({ status: 'ready', dirty: false });
    expect(approval).toEqual({ status: 'approved' });

    f.emitLine('Grbl 1.1f');
    await flush();
    expect(f.write).toHaveBeenCalledWith('M5\n');
    expect(f.write).toHaveBeenCalledWith('M9\n');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    expect(controllerOperationOwner(useLaserStore.getState().controllerOperation!)).toBe(
      privateOwner,
    );
    f.emitLine('ok');
    f.emitLine('ok');
    f.emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
    await expect(wake).resolves.toBe('idle');
    recoverySettled = true;
  } finally {
    if (!recoverySettled) await settleWakeBeforeTeardown(f, wake);
  }
});

const continuations: ReadonlyArray<{
  readonly kind: string;
  readonly initial: LaserControllerOperation;
  readonly next: LaserControllerOperation;
}> = [
  {
    kind: 'recovery',
    initial: { kind: 'recovery', phase: 'reset', idleReports: 0 },
    next: { kind: 'recovery', phase: 'awaiting-idle', idleReports: 1 },
  },
  {
    kind: 'autofocus',
    initial: { kind: 'autofocus', phase: 'preflight', idleReports: 0 },
    next: { kind: 'autofocus', phase: 'command', idleReports: 0 },
  },
  {
    kind: 'post-job-settle',
    initial: { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 },
    next: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 1 },
  },
  {
    kind: 'start-arming',
    initial: { kind: 'start-arming', phase: 'queue-fence' },
    next: { kind: 'start-arming', phase: 'live-status' },
  },
  {
    kind: 'work-z-recovery',
    initial: { kind: 'work-z-recovery', phase: 'modal-state' },
    next: { kind: 'work-z-recovery', phase: 'offsets' },
  },
];

it.each(continuations)(
  'keeps $kind continuation ownership through Abort and final approval',
  async ({ initial, next }) => {
    const first = { ...initial };
    const continued = continueControllerOperation(first, { ...next });
    const repeated = continueControllerOperation(continued, { ...continued });
    expect(controllerOperationOwner(repeated)).toBe(first);
    expect(continued).toEqual(next);
    expect(Object.keys(continued)).toEqual(Object.keys(next));
    useLaserStore.setState({
      controllerOperation: first,
      stopJob: vi.fn(async () => useLaserStore.setState({ controllerOperation: continued })),
    });
    await expect(desktopCloseController.prepare(90)).resolves.toEqual({
      status: 'ready',
      dirty: false,
    });
    useLaserStore.setState({ controllerOperation: repeated });
    expect(desktopCloseController.approve(90)).toEqual({ status: 'approved' });
  },
);

it.each(continuations)(
  'rejects a true same-kind $kind replacement while Abort is pending',
  async ({ initial }) => {
    const first = { ...initial };
    const replacement = { ...initial };
    expect(controllerOperationOwner(replacement)).not.toBe(controllerOperationOwner(first));
    useLaserStore.setState({
      controllerOperation: first,
      stopJob: vi.fn(async () => useLaserStore.setState({ controllerOperation: replacement })),
    });
    const prepared = desktopCloseController.prepare(90);
    await flush();
    expect(desktopCloseController.getNotice()).toMatchObject({ kind: 'failed', retry: true });
    desktopCloseController.keepOpen();
    await expect(prepared).resolves.toEqual({ status: 'cancelled' });
  },
);
