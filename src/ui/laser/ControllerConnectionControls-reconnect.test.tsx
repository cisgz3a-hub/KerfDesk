import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import { flushPromises } from '../../__fixtures__/controllers/cnc-pause-resume-store';
import type { PlatformAdapter } from '../../platform/types';
import { PlatformProvider } from '../app/platform-context';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useToastStore } from '../state/toast-store';
import {
  acknowledgeAndSettleFrameLeg,
  acknowledgeFrameToolOffPrelude,
  acknowledgeMotionSettlement,
  makeConnection,
  type FakeConnection,
} from '../state/laser-store-motion-operation.test-support';
import { settleTestGrblHandshake, startTestLaserJob } from '../state/laser-test-start-helpers';
import { ControllerConnectionControls } from './ControllerConnectionControls';
import { installFrameOnceProject } from './frame-once.test-support';
import { ensureFramedRunInvalidationSubscriptions } from './framed-run-invalidation';
import { reviewPendingFramedRunPermitForCurrentState } from './framed-run-testing';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const IDLE = '<Idle|MPos:0.000,0.000,0.000|WCO:0.000,0.000,0.000|FS:0,0|Ov:100,100,100>';
const INFORMATION_REPLIES: Readonly<Record<string, readonly string[]>> = {
  '$$\n': ['$30=1000', '$31=0', '$32=1', 'ok'],
  '$I\n': ['[VER:1.1h.20190830:test]', '[OPT:VM,15,128]', 'ok'],
  '$G\n': ['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok'],
};
let host: HTMLDivElement | null = null;
let root: Root | null = null;
let current: ReturnType<typeof fixture> | null = null;

function replyToInformationRead(data: string, emit: (line: string) => void): void {
  for (const line of INFORMATION_REPLIES[data] ?? []) emit(line);
}

function portFixture() {
  const writes: string[] = [];
  const controls: {
    rejectReset: boolean;
    resetGreeting: boolean;
    beforeResetWrite?: () => void;
  } = { rejectReset: false, resetGreeting: true };
  const closeListeners = new Set<() => void>();
  const close = vi.fn(async () => undefined);
  const baseConnection = makeConnection(
    async (data) => {
      writes.push(data);
      if (data === RT_SOFT_RESET) {
        controls.beforeResetWrite?.();
        if (controls.rejectReset) throw new Error('Reset transport rejected.');
        if (controls.resetGreeting) connection.emitLine('Grbl 1.1f');
      }
      if (data === '?') connection.emitLine(IDLE);
      if (
        data === '$$\n' ||
        useLaserStore.getState().controllerOperation?.kind !== 'connection-handshake'
      ) {
        replyToInformationRead(data, connection.emitLine);
      }
      if (
        useLaserStore.getState().motionOperation === null &&
        (data === 'M5\n' || data === 'M9\n')
      ) {
        connection.emitLine('ok');
      }
    },
    close,
    { autoAckStartFence: true },
  );
  const connection: FakeConnection = {
    ...baseConnection,
    onClose: (listener: () => void) => {
      closeListeners.add(listener);
      return () => closeListeners.delete(listener);
    },
  };
  const open = vi.fn(async () => connection);
  const resetCount = () => writes.filter((line) => line === RT_SOFT_RESET).length;
  const drop = () => {
    for (const listener of closeListeners) listener();
  };
  return { writes, controls, close, connection, open, resetCount, drop };
}

function fixture() {
  const original = portFixture();
  const replacement = portFixture();
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
  return { original, replacement, requestPort, platform };
}

function CurrentControllerControls(): JSX.Element {
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

async function render(platform: PlatformAdapter): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(
      <PlatformProvider adapter={platform}>
        <CurrentControllerControls />
      </PlatformProvider>,
    );
  });
  return host;
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const result = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === label,
  );
  if (!(result instanceof HTMLButtonElement)) throw new Error(`Missing button: ${label}`);
  return result;
}

async function connect(): Promise<ReturnType<typeof fixture>> {
  const f = fixture();
  current = f;
  await useLaserStore.getState().connect(f.platform);
  f.original.connection.emitLine('Grbl 1.1f');
  f.original.connection.emitLine(IDLE);
  await settleTestGrblHandshake();
  expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
  f.original.writes.length = 0;
  return f;
}

async function failedReset(): Promise<ReturnType<typeof fixture>> {
  const f = await connect();
  await startTestLaserJob('G1 X1 S100\nG1 X2 S100');
  f.original.controls.rejectReset = true;
  const stop = useLaserStore
    .getState()
    .stopJob()
    .catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(600);
  expect(await stop).toBeInstanceOf(Error);
  expect(useLaserStore.getState()).toMatchObject({
    connection: { kind: 'connected' },
    controllerOperation: { kind: 'recovery', phase: 'reset' },
    controllerQualification: { kind: 'failed' },
    safetyNotice: { kind: 'write-failed', action: 'stop' },
  });
  expect(f.original.resetCount()).toBe(1);
  return f;
}

async function completeFrame(f: ReturnType<typeof fixture>) {
  const candidate = (await reviewPendingFramedRunPermitForCurrentState()).candidate;
  expect(candidate.spatialSignature).toEqual(expect.any(String));
  const bounds =
    candidate.preparedStart.metrics.frameMotionBounds ??
    candidate.preparedStart.metrics.frameJobBounds;
  if (bounds === null) throw new Error('The prepared artwork has no Frame bounds.');
  await useLaserStore.getState().frame(bounds, 1000, candidate);
  await acknowledgeFrameToolOffPrelude(f.original.connection);
  // The artwork's perimeter has five legs, then returns to the reported head position.
  for (let leg = 0; leg < 6; leg++) await acknowledgeAndSettleFrameLeg(f.original.connection);
  await acknowledgeMotionSettlement(f.original.connection, IDLE);
  await flushPromises();
  const state = useLaserStore.getState();
  expect(state.motionOperation).toBeNull();
  expect(state.lastWriteError).toBeNull();
  const permit = state.framedRun;
  expect(permit).toMatchObject({ kind: 'ready' });
  expect(permit?.candidate).toBe(candidate);
  expect(state.frameVerification).toBe(candidate.frameVerification);
  expect(state.completedFrame).toBe(permit);
  return { candidate, permit };
}

beforeEach(() => {
  vi.useFakeTimers();
  installFrameOnceProject();
  ensureFramedRunInvalidationSubscriptions();
  useLaserStore.setState(initialLaserState());
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  current?.original.drop();
  current?.replacement.drop();
  current = null;
  await flushPromises();
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ControllerConnectionControls current reconnect ownership', () => {
  it.each(['Reconnect controller', 'Reconnect controller…'])(
    'rechecks a stale enabled %s when the same port finishes recovery before React updates',
    async (label) => {
      const f = await failedReset();
      const notice = useLaserStore.getState().safetyNotice;
      const container = await render(f.platform);
      const reconnect = button(container, label);
      expect(reconnect.disabled).toBe(false);
      let clicked = false;
      const unsubscribe = useLaserStore.subscribe((state) => {
        if (clicked || state.controllerQualification.kind !== 'qualified') return;
        clicked = true;
        // A real late boot completes qualification during this store update.
        // The enabled DOM control still belongs to the previous render.
        expect(reconnect.disabled).toBe(false);
        expect(state.getControllerReconnectRecommended()).toBe(false);
        reconnect.click();
      });
      try {
        await act(async () => {
          f.original.controls.rejectReset = false;
          f.original.connection.emitLine('Grbl 1.1f');
          f.original.connection.emitLine(IDLE);
          await vi.advanceTimersByTimeAsync(250);
        });
      } finally {
        unsubscribe();
      }
      expect(clicked).toBe(true);
      expect(f.requestPort).toHaveBeenCalledOnce();
      expect(f.original.close).not.toHaveBeenCalled();
      expect(f.replacement.open).not.toHaveBeenCalled();
      expect(f.original.resetCount()).toBe(1);
      expect(f.replacement.resetCount()).toBe(0);
      expect(useLaserStore.getState().safetyNotice).toBe(notice);
      expect(useLaserStore.getState().controllerQualification.kind).toBe('qualified');
    },
  );

  it.each(['Reconnect controller', 'Reconnect controller…'])(
    'uses %s to replace an unresolved failed reset exactly once and retain its warning',
    async (label) => {
      const f = await failedReset();
      const notice = useLaserStore.getState().safetyNotice;
      const container = await render(f.platform);
      const reconnect = button(container, label);
      expect(reconnect.disabled).toBe(false);
      expect(button(container, 'Disconnect').disabled).toBe(false);
      await act(async () => {
        reconnect.click();
        reconnect.click();
        await vi.advanceTimersByTimeAsync(1_000);
      });
      expect(f.requestPort).toHaveBeenCalledTimes(2);
      expect(f.original.close).toHaveBeenCalledOnce();
      expect(f.replacement.open).toHaveBeenCalledOnce();
      expect(f.replacement.close).not.toHaveBeenCalled();
      expect(f.original.resetCount()).toBe(1);
      expect(f.replacement.resetCount()).toBe(0);
      expect(useLaserStore.getState()).toMatchObject({
        connection: { kind: 'connected' },
        controllerQualification: { kind: 'qualified' },
        streamer: null,
      });
      expect(useLaserStore.getState().safetyNotice).toBe(notice);
    },
  );

  it.each(['Reconnect controller', 'Reconnect controller…'])(
    'reports a rejected %s action instead of dropping its promise',
    async (label) => {
      const f = await failedReset();
      const connectController = useLaserStore.getState().connect;
      const rejectedConnect = vi.fn(async () => {
        throw new Error('Controller replacement failed.');
      });
      useToastStore.setState({ toasts: [] });
      useLaserStore.setState({ connect: rejectedConnect });
      try {
        const container = await render(f.platform);
        await act(async () => {
          button(container, label).click();
          await flushPromises();
        });
        expect(rejectedConnect).toHaveBeenCalledOnce();
        expect(useToastStore.getState().toasts).toMatchObject([
          { message: 'Reconnect: Controller replacement failed.', variant: 'error' },
        ]);
        expect(f.original.close).not.toHaveBeenCalled();
      } finally {
        await act(async () => useLaserStore.setState({ connect: connectController }));
        for (const toast of useToastStore.getState().toasts) {
          useToastStore.getState().dismissToast(toast.id);
        }
      }
    },
  );

  it('locks connection controls for an ordinary owner and restores the failed-reset escape', async () => {
    const f = await failedReset();
    const recoveryOwner = useLaserStore.getState().controllerOperation;
    const container = await render(f.platform);
    expect(button(container, 'Reconnect controller').disabled).toBe(false);
    await act(async () => {
      useLaserStore.setState({
        controllerOperation: {
          kind: 'interactive-command',
          phase: 'command',
          label: 'Reading controller build information',
        },
      });
    });
    expect(button(container, 'Disconnect').disabled).toBe(true);
    expect(container.textContent).not.toContain('Reconnect controller');
    await act(async () => useLaserStore.setState({ controllerOperation: recoveryOwner }));
    expect(button(container, 'Disconnect').disabled).toBe(false);
    expect(button(container, 'Reconnect controller').disabled).toBe(false);
    expect(f.requestPort).toHaveBeenCalledOnce();
    expect(f.original.close).not.toHaveBeenCalled();
  });

  it.each([['motion', { motionOperation: startMotionOperation('jog') }]] as const)(
    'keeps both reconnect controls disabled during %s',
    async (_label, patch) => {
      const f = await failedReset();
      const container = await render(f.platform);
      await act(async () => useLaserStore.setState(patch));
      const reconnect = button(container, 'Reconnect controller');
      const noticeReconnect = button(container, 'Reconnect controller…');
      expect(reconnect.disabled).toBe(true);
      expect(noticeReconnect.disabled).toBe(true);
      await act(async () => {
        reconnect.click();
        noticeReconnect.click();
      });
      expect(f.requestPort).toHaveBeenCalledOnce();
      expect(f.original.close).not.toHaveBeenCalled();
      expect(f.original.resetCount()).toBe(1);
    },
  );

  it('preserves the exact completed Frame permit through a healthy same-port Retry', async () => {
    const f = await connect();
    const { candidate, permit } = await completeFrame(f);
    const before = useLaserStore.getState();
    useLaserStore.setState({
      controllerQualification: {
        kind: 'failed',
        epoch: before.controllerSessionEpoch,
        message: 'The settings response was empty.',
      },
    });
    f.original.writes.length = 0;
    const container = await render(f.platform);
    const retry = button(container, 'Retry reading controller settings');
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
      await flushPromises();
    });
    expect(f.original.writes).toEqual(['$$\n', '$I\n', '$G\n']);
    expect(f.requestPort).toHaveBeenCalledOnce();
    expect(f.original.close).not.toHaveBeenCalled();
    const after = useLaserStore.getState();
    expect(after.controllerQualification.kind).toBe('qualified');
    expect(after.framedRun).toBe(permit);
    expect(after.completedFrame).toBe(permit);
    expect(after.frameVerification).toBe(candidate.frameVerification);
    expect(after.controllerSessionEpoch).toBe(before.controllerSessionEpoch);
    expect(after.trustedPositionEpoch).toBe(before.trustedPositionEpoch);
  });

  it('revokes a completed exact Frame synchronously when Abort claims a rejected reset', async () => {
    const f = await connect();
    await completeFrame(f);
    f.original.controls.rejectReset = true;
    let observedResetClaim = false;
    f.original.controls.beforeResetWrite = () => {
      // The reset owns the proof before its transport promise, greeting or
      // final Stop patch can settle. Main may first stop unowned motion while
      // preserving position, before deciding a reset is required.
      observedResetClaim = true;
      const claimed = useLaserStore.getState();
      expect(claimed.controllerOperation).toMatchObject({ kind: 'recovery', phase: 'reset' });
      expect(claimed.frameVerification).toBeNull();
      expect(claimed.framedRun).toBeNull();
      expect(claimed.completedFrame).toBeNull();
    };
    const abort = useLaserStore
      .getState()
      .stopJob()
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(600);
    expect(observedResetClaim).toBe(true);
    expect(await abort).toBeInstanceOf(Error);
    expect(useLaserStore.getState().frameVerification).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(f.original.close).not.toHaveBeenCalled();
  });
});
