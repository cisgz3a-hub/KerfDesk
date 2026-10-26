import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { StatusReport } from '../../../core/controllers/grbl';
import type { BoardOutlineDraft, BoardShape, Vec2 } from '../../../core/scene';
import type { BoardCapture, BoardCaptureState } from './use-board-capture';
import { createOutlineFinishHandler } from './use-board-outline-handlers';
import { useBoardCaptureHandlers, type BoardCaptureHandlers } from './use-board-capture-handlers';
import { resetStore } from '../../state/test-helpers';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useBoardVerification, type BoardVerificationController } from './use-board-verification';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OutlineShape = Extract<BoardShape, { readonly kind: 'outline' }>;

const originalLaserState = useLaserStore.getState();
let unmount: (() => Promise<void>) | null = null;

const DRAFT: BoardOutlineDraft = {
  localPointsMm: [
    { x: 0, y: 0 },
    { x: 80, y: 0 },
    { x: 60, y: 40 },
    { x: 0, y: 60 },
  ],
  anchorIndices: [0, 1, 2, 3],
  captureOrder: [3, 1],
};

function captureWith(corners: BoardCaptureState['corners']): BoardCapture {
  return {
    state: {
      shapeKind: 'outline',
      circleMethod: 'rim-fit',
      outlineDraft: DRAFT,
      corners,
      captureEpoch: {
        controllerSessionEpoch: 1,
        trustedPositionEpoch: 1,
        workOriginVersion: 1,
      },
      geometry: null,
      registrationEpoch: null,
      outlineId: null,
      sessionRevision: 1,
      committed: false,
    },
    setShape: vi.fn(),
    setCircleMethod: vi.fn(),
    setOutlineDraft: vi.fn(),
    capture: vi.fn(),
    undo: vi.fn(),
    commit: vi.fn(),
    updateGeometry: vi.fn(),
    isSessionCurrent: () => true,
    reset: vi.fn(),
  };
}

describe('createOutlineFinishHandler', () => {
  beforeEach(() => {
    resetStore();
    useLaserStore.setState({
      controllerSessionEpoch: 1,
      trustedPositionEpoch: 1,
      workOriginVersion: 1,
    });
  });
  afterEach(async () => {
    await unmount?.();
    unmount = null;
    useLaserStore.setState(originalLaserState, true);
  });

  it('sets the calculated front-left origin before registering the drawn outline', async () => {
    const calls: string[] = [];
    const setOriginAtMachinePoint = vi.fn(async (point) => {
      calls.push('origin');
      expect(point.x).toBeCloseTo(100);
      expect(point.y).toBeCloseTo(-260);
    });
    const registerCapturedBoardOutline = vi.fn((shape: OutlineShape, rotationDeg: number) => {
      calls.push('register');
      useStore.getState().registerCapturedBoardOutline(shape, rotationDeg);
    });
    const addCapturedBoard = vi.fn();
    const capture = captureWith([
      { x: 100, y: -260 },
      { x: 180, y: -200 },
    ]);
    const handlers = await renderHandlers({
      capture,
      setOriginAtMachinePoint,
      addCapturedBoard,
      registerCapturedBoardOutline,
    });
    await act(async () => handlers().onFinishOutline());

    expect(calls).toEqual(['origin', 'register']);
    expect(setOriginAtMachinePoint).toHaveBeenCalledOnce();
    expect(addCapturedBoard).not.toHaveBeenCalled();
    expect(registerCapturedBoardOutline).toHaveBeenCalledOnce();
    expect(capture.commit).toHaveBeenCalledOnce();
  });

  it('reports a ten percent mismatch without writing an origin or board', async () => {
    const setOriginAtMachinePoint = vi.fn(async () => undefined);
    const commit = vi.fn();
    const setError = vi.fn();
    const handler = createOutlineFinishHandler(
      {
        capture: captureWith([
          { x: 100, y: -260 },
          { x: 188, y: -194 },
        ]),
        device: { ...DEFAULT_DEVICE_PROFILE, origin: 'front-left' },
        setOriginAtMachinePoint,
      },
      commit,
      setError,
      vi.fn(),
      vi.fn(),
    );

    await handler();

    expect(setError).toHaveBeenCalledWith(expect.stringContaining('The head positions are'));
    expect(setOriginAtMachinePoint).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['controllerSessionEpoch', 'trustedPositionEpoch', 'workOriginVersion'] as const)(
    'refuses stale %s before writing an outline origin',
    async (key) => {
      const capture = captureWith([
        { x: 100, y: -260 },
        { x: 180, y: -200 },
      ]);
      useLaserStore.setState({ [key]: 2 });
      const write = vi.fn(async () => undefined);
      const commit = vi.fn();
      const handler = createOutlineFinishHandler(
        { capture, device: DEFAULT_DEVICE_PROFILE, setOriginAtMachinePoint: write },
        commit,
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      await expect(handler()).rejects.toThrow('coordinates changed');
      expect(write).not.toHaveBeenCalled();
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it.each(['document', 'capture', 'origin'] as const)(
    'does not commit when %s ownership changes during the origin write',
    async (change) => {
      let current = true;
      const capture = {
        ...captureWith([
          { x: 100, y: -260 },
          { x: 180, y: -200 },
        ]),
        isSessionCurrent: () => current,
      };
      const write = vi.fn(async () => {
        if (change === 'document')
          useStore.setState({ projectDocumentEpoch: useStore.getState().projectDocumentEpoch + 1 });
        if (change === 'capture') current = false;
        if (change === 'origin') useLaserStore.setState({ workOriginVersion: 3 });
      });
      const commit = vi.fn();
      const handler = createOutlineFinishHandler(
        { capture, device: DEFAULT_DEVICE_PROFILE, setOriginAtMachinePoint: write },
        commit,
        vi.fn(),
        vi.fn(),
        vi.fn(),
      );
      await expect(handler()).rejects.toThrow();
      expect(commit).not.toHaveBeenCalled();
    },
  );

  it('accepts the single work-origin advance owned by registration', async () => {
    const capture = captureWith([
      { x: 100, y: -260 },
      { x: 180, y: -200 },
    ]);
    const commit = vi.fn();
    const write = vi.fn(async () => {
      useLaserStore.setState({ workOriginVersion: 2 });
    });
    const handler = createOutlineFinishHandler(
      { capture, device: DEFAULT_DEVICE_PROFILE, setOriginAtMachinePoint: write },
      commit,
      vi.fn(),
      vi.fn(),
      vi.fn(),
    );
    await handler();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('records the current head position when an outline anchor is accepted', async () => {
    const target = { kind: 'outline' as const, index: 2, ordinal: 3 };
    const onCorrect = vi.fn(async () => undefined);
    useLaserStore.setState({
      connection: { kind: 'connected' },
      autofocusBusy: false,
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
      motionOperation: null,
      controllerOperation: null,
      streamer: null,
      mpgActive: false,
      statusReport: statusAt(10, 20),
      statusSequence: 20,
      wcoCache: null,
      jogToMachinePosition: vi.fn(async () => undefined),
    });
    const controller = await renderOutlineVerification(onCorrect);
    await act(async () => {
      controller().selectTarget(target);
      await Promise.resolve();
    });
    act(() => {
      useLaserStore.setState({ statusReport: statusAt(71, 81), statusSequence: 21 });
    });
    await act(async () => {
      controller().acceptTarget();
      await Promise.resolve();
    });
    expect(onCorrect).toHaveBeenCalledWith(target, expect.objectContaining({ x: 71, y: 81 }));
    expect(controller().feedback).toBe('Anchor 3 checked.');
  });
});

async function renderHandlers(args: {
  readonly capture: BoardCapture;
  readonly setOriginAtMachinePoint: (point: { x: number; y: number }) => Promise<void>;
  readonly addCapturedBoard: (shape: BoardShape) => void;
  readonly registerCapturedBoardOutline: (shape: OutlineShape, rotationDeg: number) => void;
}): Promise<() => BoardCaptureHandlers> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: BoardCaptureHandlers | null = null;
  function Probe(): null {
    current = useBoardCaptureHandlers({
      capture: args.capture,
      livePosition: null,
      device: { ...DEFAULT_DEVICE_PROFILE, origin: 'front-left' },
      setOriginHere: async () => undefined,
      setOriginAtMachinePoint: args.setOriginAtMachinePoint,
      addCapturedBoard: args.addCapturedBoard,
      registerCapturedBoardOutline: args.registerCapturedBoardOutline,
      updateCapturedBoard: vi.fn(),
    });
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return () => {
    if (current === null) throw new Error('Handlers were not rendered.');
    return current;
  };
}

async function renderOutlineVerification(
  onCorrect: (
    target: Parameters<BoardVerificationController['selectTarget']>[0],
    position: Vec2,
  ) => Promise<void>,
): Promise<() => BoardVerificationController> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: BoardVerificationController | null = null;
  function Probe(): null {
    const controller = useBoardVerification({
      geometry: {
        kind: 'outline',
        localPointsMm: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 60, y: 60 },
        ],
        anchorIndices: [0, 1, 2],
        viewSigns: { x: 1, y: 1 },
        measured: [
          { index: 0, machine: { x: 10, y: 20 } },
          { index: 1, machine: { x: 110, y: 20 } },
        ],
      },
      registrationEpoch: {
        controllerSessionEpoch: 1,
        trustedPositionEpoch: 1,
        workOriginVersion: 1,
      },
      currentEpoch: {
        controllerSessionEpoch: 1,
        trustedPositionEpoch: 1,
        workOriginVersion: 1,
      },
      feed: 600,
      disabled: false,
      onCorrect,
    });
    current = controller;
    return null;
  }
  await act(async () => root.render(createElement(Probe)));
  unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
  };
  return () => {
    if (current === null) throw new Error('Verification controller was not rendered.');
    return current;
  };
}

function statusAt(x: number, y: number): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x, y, z: 0 },
    wPos: null,
    feed: null,
    spindle: null,
    wco: null,
  };
}
