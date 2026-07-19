import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../../core/controllers/grbl';
import type {
  BoardVerificationTarget,
  CapturedBoardGeometry,
} from '../../../core/scene/board-verification';
import { startMotionOperation } from '../../state/laser-motion-operation';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import type { BoardRegistrationEpoch } from './use-board-capture';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaserState = useLaserStore.getState();
const mountedViews: Array<{ readonly unmount: () => Promise<void> }> = [];

const RECTANGLE: CapturedBoardGeometry = {
  kind: 'rect',
  origin: { x: 10, y: 20 },
  widthMm: 120,
  heightMm: 80,
};
const TOP_RIGHT: BoardVerificationTarget = { kind: 'rect', anchor: 'top-right' };
const BOTTOM_RIGHT: BoardVerificationTarget = { kind: 'rect', anchor: 'bottom-right' };
const REGISTERED_EPOCH: BoardRegistrationEpoch = {
  controllerSessionEpoch: 7,
  trustedPositionEpoch: 11,
  workOriginVersion: 3,
};

afterEach(async () => {
  while (mountedViews.length > 0) await mountedViews.pop()?.unmount();
  useLaserStore.setState(originalLaserState, true);
  vi.restoreAllMocks();
});

describe('useBoardVerification', () => {
  it('moves to the selected machine point and waits for dispatch plus a fresh Idle report', async () => {
    const move = deferred<undefined>();
    const jogToMachinePosition = vi.fn(() => move.promise);
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 40,
    });
    const view = await renderController({ onCorrect });

    act(() => view.current().selectTarget(TOP_RIGHT));

    expect(jogToMachinePosition).toHaveBeenCalledWith(130, 100, 600);
    expect(view.current().activeTarget).toEqual(TOP_RIGHT);
    expect(view.current().ready).toBe(false);

    await act(async () => {
      move.resolve(undefined);
      await move.promise;
    });
    expect(view.current().ready).toBe(false);

    act(() => {
      useLaserStore.setState({
        statusReport: statusAt('Run', 130, 100),
        statusSequence: 41,
      });
    });
    expect(view.current().ready).toBe(false);

    act(() => {
      useLaserStore.setState({
        statusReport: statusAt('Idle', 130, 100),
        statusSequence: 42,
      });
    });
    expect(view.current().ready).toBe(true);

    act(() => view.current().acceptTarget());
    expect(onCorrect).not.toHaveBeenCalled();
    expect(view.current().activeTarget).toBeNull();
    expect(view.current().feedback).toBe('Top-right corner confirmed.');
  });

  it('uses the fresh current head position only after the operator chooses to adjust', async () => {
    const jogToMachinePosition = vi.fn(async () => undefined);
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 20,
    });
    const view = await renderController({ onCorrect });

    await act(async () => {
      view.current().selectTarget(BOTTOM_RIGHT);
      await Promise.resolve();
    });
    expect(jogToMachinePosition).toHaveBeenCalledWith(130, 20, 600);
    expect(view.current().ready).toBe(false);

    act(() => {
      useLaserStore.setState({
        statusReport: statusAt('Idle', 130, 20),
        statusSequence: 21,
      });
    });
    expect(view.current().ready).toBe(true);

    act(() => view.current().adjustTarget());
    expect(view.current().adjusting).toBe(true);
    expect(onCorrect).not.toHaveBeenCalled();

    act(() => {
      useLaserStore.setState({
        statusReport: statusAt('Idle', 145, 24),
        statusSequence: 22,
      });
    });
    await act(async () => {
      view.current().confirmCurrentPosition();
      await Promise.resolve();
    });

    expect(onCorrect).toHaveBeenCalledOnce();
    expect(onCorrect).toHaveBeenCalledWith(
      BOTTOM_RIGHT,
      expect.objectContaining({ x: 145, y: 24 }),
    );
    expect(view.current().activeTarget).toBeNull();
    expect(view.current().feedback).toBe(
      'Bottom-right corner updated from the current head position.',
    );
  });

  it('surfaces a rejected move and does not allow correction', async () => {
    const jogToMachinePosition = vi.fn(() => Promise.reject(new Error('Controller rejected jog')));
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 5,
    });
    const view = await renderController({ onCorrect });

    await act(async () => {
      view.current().selectTarget(TOP_RIGHT);
      await Promise.resolve();
    });

    expect(view.current().activeTarget).toBeNull();
    expect(view.current().ready).toBe(false);
    expect(view.current().error).toBe('Controller rejected jog');
    expect(onCorrect).not.toHaveBeenCalled();
  });

  it('keeps the session locked until physical jog cancellation settles', async () => {
    const move = deferred<undefined>();
    const cancellation = deferred<undefined>();
    const jogToMachinePosition = vi.fn(() => {
      useLaserStore.setState({ motionOperation: startMotionOperation('jog') });
      return move.promise;
    });
    const cancelJog = vi.fn(() => cancellation.promise);
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 5,
    });
    useLaserStore.setState({ cancelJog });
    const view = await renderController({ onCorrect });

    act(() => view.current().selectTarget(TOP_RIGHT));
    act(() => view.current().cancel());

    expect(cancelJog).toHaveBeenCalledOnce();
    expect(view.current().activeTarget).toEqual(TOP_RIGHT);
    expect(view.current().cancelling).toBe(true);

    await act(async () => {
      cancellation.resolve(undefined);
      await cancellation.promise;
    });
    expect(view.current().activeTarget).toBeNull();
    expect(view.current().cancelling).toBe(false);

    await act(async () => {
      move.resolve(undefined);
      await move.promise;
    });
    expect(view.current().activeTarget).toBeNull();
  });

  it('retains the session and reports an unconfirmed physical cancellation', async () => {
    const jogToMachinePosition = vi.fn(() => {
      useLaserStore.setState({ motionOperation: startMotionOperation('jog') });
      return new Promise<void>(() => undefined);
    });
    const cancelJog = vi.fn(() => Promise.reject(new Error('Cancel fence timed out')));
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 5,
    });
    useLaserStore.setState({ cancelJog });
    const view = await renderController({ onCorrect });

    act(() => view.current().selectTarget(TOP_RIGHT));
    await act(async () => {
      view.current().cancel();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(cancelJog).toHaveBeenCalledOnce();
    expect(view.current().activeTarget).toEqual(TOP_RIGHT);
    expect(view.current().cancelling).toBe(false);
    expect(view.current().error).toBe('Cancel fence timed out');
  });

  it('does not promise physical cancellation when the controller cannot stop a jog', async () => {
    const jogToMachinePosition = vi.fn(() => {
      useLaserStore.setState({ motionOperation: startMotionOperation('jog') });
      return new Promise<void>(() => undefined);
    });
    const cancelJog = vi.fn(async () => undefined);
    const onCorrect = vi.fn(async () => undefined);
    setLaserState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 5,
    });
    useLaserStore.setState((state) => ({
      cancelJog,
      capabilities: { ...state.capabilities, jogCancel: false },
    }));
    const view = await renderController({ onCorrect });

    act(() => view.current().selectTarget(TOP_RIGHT));
    act(() => view.current().cancel());

    expect(view.current().canCancelMove).toBe(false);
    expect(cancelJog).not.toHaveBeenCalled();
    expect(view.current().activeTarget).toEqual(TOP_RIGHT);
    expect(view.current().error).toMatch(/cannot stop a dispatched point move/i);
  });

  it.each([
    {
      name: 'controller session',
      controllerSessionEpoch: REGISTERED_EPOCH.controllerSessionEpoch + 1,
      trustedPositionEpoch: REGISTERED_EPOCH.trustedPositionEpoch,
      workOriginVersion: REGISTERED_EPOCH.workOriginVersion,
    },
    {
      name: 'trusted position',
      controllerSessionEpoch: REGISTERED_EPOCH.controllerSessionEpoch,
      trustedPositionEpoch: REGISTERED_EPOCH.trustedPositionEpoch + 1,
      workOriginVersion: REGISTERED_EPOCH.workOriginVersion,
    },
    {
      name: 'work origin',
      controllerSessionEpoch: REGISTERED_EPOCH.controllerSessionEpoch,
      trustedPositionEpoch: REGISTERED_EPOCH.trustedPositionEpoch,
      workOriginVersion: REGISTERED_EPOCH.workOriginVersion + 1,
    },
  ])('blocks verification after the $name epoch changes', async (currentEpoch) => {
    const jogToMachinePosition = vi.fn(async () => undefined);
    const onCorrect = vi.fn(async () => undefined);
    useLaserStore.setState({
      jogToMachinePosition,
      statusReport: statusAt('Idle', 10, 20),
      statusSequence: 10,
      controllerSessionEpoch: currentEpoch.controllerSessionEpoch,
      trustedPositionEpoch: currentEpoch.trustedPositionEpoch,
      workOriginVersion: currentEpoch.workOriginVersion,
    });
    const view = await renderController({ onCorrect });

    expect(view.current().epochValid).toBe(false);
    act(() => view.current().selectTarget(TOP_RIGHT));

    expect(jogToMachinePosition).not.toHaveBeenCalled();
    expect(view.current().activeTarget).toBeNull();
    expect(view.current().ready).toBe(false);
    expect(view.current().error).toBe(
      'The board outline or machine coordinates changed. Capture the board again before checking it.',
    );
    expect(onCorrect).not.toHaveBeenCalled();
  });
});

function VerificationProbe(props: {
  readonly geometry: CapturedBoardGeometry;
  readonly registrationEpoch: BoardRegistrationEpoch;
  readonly onCorrect: (
    target: BoardVerificationTarget,
    position: { readonly x: number; readonly y: number },
  ) => Promise<void>;
  readonly publish: (controller: BoardVerificationController) => void;
}): null {
  const statusReport = useLaserStore((state) => state.statusReport);
  const controllerSessionEpoch = useLaserStore((state) => state.controllerSessionEpoch);
  const trustedPositionEpoch = useLaserStore((state) => state.trustedPositionEpoch ?? 0);
  const workOriginVersion = useLaserStore((state) => state.workOriginVersion ?? 0);
  const controller = useBoardVerification({
    geometry: props.geometry,
    registrationEpoch: props.registrationEpoch,
    currentEpoch: { controllerSessionEpoch, trustedPositionEpoch, workOriginVersion },
    feed: 600,
    disabled: statusReport?.state !== 'Idle',
    onCorrect: props.onCorrect,
  });
  props.publish(controller);
  return null;
}

async function renderController(args: {
  readonly onCorrect: (
    target: BoardVerificationTarget,
    position: { readonly x: number; readonly y: number },
  ) => Promise<void>;
}): Promise<{
  readonly current: () => BoardVerificationController;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  let controller: BoardVerificationController | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <VerificationProbe
        geometry={RECTANGLE}
        registrationEpoch={REGISTERED_EPOCH}
        onCorrect={args.onCorrect}
        publish={(next) => {
          controller = next;
        }}
      />,
    );
  });
  mountedViews.push({
    unmount: async () => {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    },
  });
  return {
    current: () => {
      if (controller === null) throw new Error('Verification controller was not rendered.');
      return controller;
    },
  };
}

function setLaserState(
  state: Pick<LaserState, 'jogToMachinePosition' | 'statusReport' | 'statusSequence'>,
): void {
  useLaserStore.setState({
    ...state,
    connection: { kind: 'connected' },
    autofocusBusy: false,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    mpgActive: false,
    controllerSessionEpoch: REGISTERED_EPOCH.controllerSessionEpoch,
    trustedPositionEpoch: REGISTERED_EPOCH.trustedPositionEpoch,
    workOriginVersion: REGISTERED_EPOCH.workOriginVersion,
    wcoCache: null,
  });
}

function statusAt(state: StatusReport['state'], x: number, y: number): StatusReport {
  return {
    state,
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
