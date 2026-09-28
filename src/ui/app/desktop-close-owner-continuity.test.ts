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

it('real Abort does not treat a recovery status update as a replacement owner', async () => {
  const lineHandlers = new Set<(line: string) => void>();
  const emitLine = (line: string) => {
    for (const handler of lineHandlers) handler(line);
  };
  let holdReset = false;
  let finishReset: () => void = () => undefined;
  const write = vi.fn(async (line: string) => {
    if (holdReset && line === '\x18') {
      await new Promise<void>((resolve) => {
        finishReset = resolve;
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
  await useLaserStore.getState().connect(adapter);
  emitLine('Grbl 1.1f');
  emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await flush();
  emitLine('ok');
  await flush();
  const wake = useLaserStore.getState().wakeController();
  await flush();
  expect(useLaserStore.getState().controllerOperation).toMatchObject({
    kind: 'recovery',
    phase: 'awaiting-idle',
  });
  const ownerBefore = useLaserStore.getState().controllerOperation;
  holdReset = true;
  const prepared = desktopCloseController.prepare(80);
  const preparedReply = vi.fn();
  void prepared.then(preparedReply);
  expect(write).toHaveBeenLastCalledWith('\x18');
  emitLine('<Run|MPos:0.000,0.000,0.000|FS:0,0>');
  expect(useLaserStore.getState().controllerOperation).toEqual(ownerBefore);
  expect(useLaserStore.getState().controllerOperation).not.toBe(ownerBefore);
  finishReset();
  await flush();
  const actualNotice = desktopCloseController.getNotice();
  const approval = desktopCloseController.approve(80);
  desktopCloseController.keepOpen();
  await prepared;
  holdReset = false;
  emitLine('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await wake;
  expect(actualNotice?.kind).not.toBe('failed');
  expect(preparedReply).toHaveBeenCalledExactlyOnceWith({ status: 'ready', dirty: false });
  expect(approval).toEqual({ status: 'approved' });
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
