import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import { flushPromises } from '../../__fixtures__/controllers/cnc-pause-resume-store';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { makeConnection } from '../state/laser-store-motion-operation.test-support';
import { settleTestGrblHandshake, startTestLaserJob } from '../state/laser-test-start-helpers';
import { ControllerConnectionControls } from './ControllerConnectionControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const IDLE = '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
const INFORMATION: Readonly<Record<string, readonly string[]>> = {
  '$$\n': ['$30=1000', '$31=0', '$32=1', 'ok'],
  '$I\n': ['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]', 'ok'],
  '$G\n': ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok'],
};
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let current: ReturnType<typeof fixture> | null = null;

function port(holdClose: boolean) {
  const controls = { rejectReset: false };
  let finishClose!: (reject: boolean) => void;
  const closeWait = new Promise<void>((resolve, reject) => {
    finishClose = (failed) => (failed ? reject(new Error('Original close failed.')) : resolve());
  });
  const close = vi.fn(async () => {
    if (holdClose) await closeWait;
  });
  const closeListeners = new Set<() => void>();
  const base = makeConnection(
    async (data) => {
      if (data === RT_SOFT_RESET) {
        if (controls.rejectReset) throw new Error('Original reset failed.');
        connection.emitLine('Grbl 1.1f');
      }
      if (data === '?') connection.emitLine(IDLE);
      if (
        data === '$$\n' ||
        useLaserStore.getState().controllerOperation?.kind !== 'connection-handshake'
      ) {
        for (const reply of INFORMATION[data] ?? []) connection.emitLine(reply);
      }
      if (data === 'M5\n' || data === 'M9\n') connection.emitLine('ok');
    },
    close,
    { autoAckStartFence: true },
  );
  const connection = {
    ...base,
    write: vi.fn(base.write),
    onClose: (listener: () => void) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
  };
  return {
    controls,
    close,
    connection,
    finishClose,
    open: vi.fn(async () => connection),
    drop: () => {
      for (const listener of closeListeners) listener();
    },
  };
}

function fixture() {
  const original = port(true);
  const replacement = port(false);
  const requestPort = vi
    .fn()
    .mockResolvedValueOnce({ open: original.open })
    .mockResolvedValue({ open: replacement.open });
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: { isSupported: () => true, requestPort },
  };
  return { original, replacement, platform };
}

function CurrentControls(): JSX.Element {
  const autofocusBusy = useLaserStore((state) => state.autofocusBusy);
  const motionOperation = useLaserStore((state) => state.motionOperation);
  const controllerOperation = useLaserStore((state) => state.controllerOperation);
  return (
    <ControllerConnectionControls
      machineKind="laser"
      autofocusBusy={autofocusBusy}
      motionOperation={motionOperation}
      controllerOperation={controllerOperation}
      onForget={() => undefined}
    />
  );
}

function button(label: string): HTMLButtonElement {
  const result = [...host!.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return result;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  current?.original.finishClose(false);
  await act(async () => root?.unmount());
  host?.remove();
  current?.original.drop();
  current?.replacement.drop();
  await flushPromises();
  current = null;
  host = null;
  root = null;
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
});

it.each([false, true])(
  'honours an acknowledged Stop warning during held connection close (close fails: %s)',
  async (closeFails) => {
    const f = fixture();
    current = f;
    await useLaserStore.getState().connect(f.platform);
    f.original.connection.emitLine('Grbl 1.1f');
    f.original.connection.emitLine(IDLE);
    await settleTestGrblHandshake();
    expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
    f.original.controls.rejectReset = true;
    const stop = useLaserStore
      .getState()
      .stopJob()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(700);
    expect(await stop).toBeInstanceOf(Error);
    const originalNotice = useLaserStore.getState().safetyNotice;
    expect(originalNotice).toMatchObject({ kind: 'write-failed', action: 'stop' });

    host = document.createElement('div');
    document.body.appendChild(host);
    await act(async () => {
      root = createRoot(host!);
      root.render(
        <PlatformProvider adapter={f.platform}>
          <CurrentControls />
        </PlatformProvider>,
      );
    });
    await act(async () => {
      button('Reconnect controller').click();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(f.original.close).toHaveBeenCalledOnce();
    expect(f.replacement.open).not.toHaveBeenCalled();
    await act(async () => button('I made the machine safe').click());
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    await act(async () => {
      f.original.finishClose(closeFails);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(1_000);
    });
    if (closeFails) {
      expect(useLaserStore.getState().safetyNotice).toMatchObject({
        kind: 'write-failed',
        action: 'disconnect',
      });
      expect(useLaserStore.getState().safetyNotice).not.toBe(originalNotice);
    } else {
      expect(f.replacement.open).toHaveBeenCalledOnce();
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
      expect(useLaserStore.getState().safetyNotice).toBeNull();
    }
  },
);

it('clears an old Fire incident when Forget joins a successfully cleaned live disconnect', async () => {
  const f = fixture();
  current = f;
  await useLaserStore.getState().connect(f.platform);
  f.original.connection.emitLine('Grbl 1.1f');
  f.original.connection.emitLine(IDLE);
  await settleTestGrblHandshake();
  const oldNotice = {
    kind: 'write-failed' as const,
    action: 'fire' as const,
    message: 'Old Fire receipt was unknown.',
  };
  useLaserStore.setState({ safetyNotice: oldNotice });

  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(10);
  expect(f.original.close).toHaveBeenCalledTimes(1);
  expect(useLaserStore.getState().safetyNotice).toBe(oldNotice);
  const forget = useLaserStore.getState().forgetDevice?.();
  expect(forget).toBeDefined();
  f.original.finishClose(false);
  await Promise.all([disconnect, forget]);

  expect(
    f.original.connection.write.mock.calls.filter(([data]) => data === RT_SOFT_RESET),
  ).toHaveLength(1);
  expect(f.original.connection.write).toHaveBeenCalledWith('M5\n');
  expect(f.original.connection.write).toHaveBeenCalledWith('M9\n');
  expect(useLaserStore.getState()).toMatchObject({
    connection: { kind: 'disconnected' },
    controllerQualification: { kind: 'disconnected' },
    safetyNotice: null,
  });
});
