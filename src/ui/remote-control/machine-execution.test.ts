import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { startMotionOperation } from '../state/laser-motion-operation';
import { installFrameOnceProject, FRAME_ONCE_IDLE } from '../laser/frame-once.test-support';
import { framedRunPermitForCurrentState } from '../laser/framed-run-testing';
import type { MachineExecutionOwner } from '../state/machine-execution-owner';
import { executeMachineOperation, type MachineExecutionContext } from './machine-execution';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { MachineCommand } from './machine-types';
import { createRendererMachineAuthorities } from '../remote-access/renderer-machine-authority';
import type { RemoteAccessStatus } from '../remote-access/remote-access-store';

const canonical = vi.hoisted(() => ({ frame: vi.fn(), start: vi.fn() }));
vi.mock('../laser/use-frame-action', () => ({ runFrameNow: canonical.frame }));
vi.mock('../laser/start-job-flow', () => ({ runFramedPermitStart: canonical.start }));
const originalJog = useLaserStore.getState().jog;
const originalStop = useLaserStore.getState().stopJob;
let owned: OwnedMachineOperation;
let context: MachineExecutionContext;
beforeEach(() => {
  installFrameOnceProject();
  canonical.frame.mockReset();
  canonical.start.mockReset();
  const authorityController = new AbortController();
  owned = {
    authority: {
      clientId: 'client',
      sessionId: 'session',
      signal: authorityController.signal,
      assertCurrent: () => authorityController.signal.throwIfAborted(),
    },
    controller: new AbortController(),
    documentEpoch: useStore.getState().projectDocumentEpoch,
    controllerEpoch: 7,
    kind: 'jog',
    state: 'accepted',
    committed: false,
    cleanup: () => undefined,
  };
  context = {
    options: {
      store: useStore,
      canWrite: () => false,
      getAppStatus: () => ({
        app: { name: 'KerfDesk', version: 'test', platform: 'desktop' },
        edition: { mode: 'free' },
        updates: { available: false },
      }),
    },
    revision: () => 'revision',
    assertOwned: (operation) => {
      operation.controller.signal.throwIfAborted();
      operation.authority.assertCurrent();
      if (useLaserStore.getState().controllerSessionEpoch !== operation.controllerEpoch)
        throw new Error('controller replaced');
    },
  };
});
afterEach(() => {
  owned.controller.abort();
  useLaserStore.setState({ ...initialLaserState(), jog: originalJog, stopJob: originalStop });
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const jog: MachineCommand = {
  command: 'jog_machine',
  args: {
    expectedRevision: 'revision',
    requestId: crypto.randomUUID(),
    axis: 'x',
    direction: 1,
    distanceMm: 2,
    feedMmPerMin: 100_000,
  },
};
function installMotion(owner: MachineExecutionOwner) {
  const motion = startMotionOperation('jog');
  useLaserStore.setState({ motionOperation: motion });
  owner.onMotionOwner?.(motion.operationId);
  owner.onDispatch?.();
  return motion;
}

describe('canonical remote machine execution', () => {
  it('clearing an older write warning does not invalidate clean new jog settlement', async () => {
    useLaserStore.setState({ lastWriteError: 'An earlier warning' });
    useLaserStore.setState({
      jog: vi.fn(async (_vector, owner: MachineExecutionOwner = {}) => {
        installMotion(owner);
        useLaserStore.setState({ lastWriteError: null });
        useLaserStore.setState({ motionOperation: null, statusReport: FRAME_ONCE_IDLE });
      }),
    });
    await executeMachineOperation(jog, owned, context);
    expect(owned).toMatchObject({ state: 'completed', committed: true });
  });
  it('uses saved-origin physical pad signs and the selected head feed clamp', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: { ...state.project.device, origin: 'rear-right', maxFeed: 1200 },
      },
    }));
    const action = vi.fn(async (_vector, owner: MachineExecutionOwner = {}) => {
      installMotion(owner);
      useLaserStore.setState({ motionOperation: null, statusReport: FRAME_ONCE_IDLE });
    });
    useLaserStore.setState({ jog: action });
    await executeMachineOperation(jog, owned, context);
    expect(action.mock.calls[0]![0]).toEqual({ dx: -2, feed: 1200 });
    expect(owned).toMatchObject({ state: 'completed', committed: true });
  });

  it.each(['cancel', 'error', 'mpg'] as const)(
    'a %s interruption followed by Idle cleanup never reports a clean completed jog',
    async (reason) => {
      useLaserStore.setState({
        jog: vi.fn(async (_vector, owner: MachineExecutionOwner = {}) => {
          const motion = installMotion(owner);
          if (reason === 'error')
            useLaserStore.setState({
              motionOperation: null,
              lastWriteError: 'error:20',
              statusReport: FRAME_ONCE_IDLE,
            });
          else {
            useLaserStore.setState({
              motionOperation: {
                ...motion,
                ...(reason === 'cancel' ? { cancelRequested: true } : { interruptedByMpg: true }),
              },
            });
            useLaserStore.setState({ motionOperation: null, statusReport: FRAME_ONCE_IDLE });
          }
        }),
      });
      await expect(executeMachineOperation(jog, owned, context)).rejects.toMatchObject({
        code: 'cancelled',
      });
      expect(owned.state).not.toBe('completed');
      expect(owned.committed).toBe(true);
    },
  );

  it('owns clean same-tick settlement before the jog transport promise resolves', async () => {
    let finish!: () => void;
    useLaserStore.setState({
      jog: vi.fn(async (_vector, owner: MachineExecutionOwner = {}) => {
        installMotion(owner);
        useLaserStore.setState({ motionOperation: null, statusReport: FRAME_ONCE_IDLE });
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
    });
    const promise = executeMachineOperation(jog, owned, context);
    expect(owned.state).toBe('running');
    finish();
    await promise;
    expect(owned).toMatchObject({ state: 'completed', committed: true });
  });

  it('Frame uses the ordinary action with cancellation, native setup suppressed and no joining', async () => {
    canonical.frame.mockResolvedValue(true);
    await executeMachineOperation(
      {
        command: 'frame_job',
        args: { expectedRevision: 'revision', requestId: crypto.randomUUID() },
      },
      owned,
      context,
    );
    expect(canonical.frame).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: owned.controller.signal,
        interactiveSetup: false,
        joinExisting: false,
        assertCurrent: expect.any(Function),
      }),
    );
    expect(owned).toMatchObject({ state: 'completed', committed: true });
  });

  it('an accepted slow Frame crossing control expiry cannot reach its first dispatch', async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const status: RemoteAccessStatus = {
      statusRevision: 1,
      enabled: true,
      available: true,
      connected: true,
      deviceId: 'device',
      controlUrl: 'https://example.test/control',
      mcpUrl: 'https://example.test/mcp',
      pairing: null,
      pairingPending: false,
      requests: [],
      error: null,
      clients: [
        { id: 'client', label: 'Phone', scopes: ['read', 'control'], controlExpiresInMs: 100 },
      ],
    };
    const grants = createRendererMachineAuthorities(
      () => true,
      () => ({
        ...status,
        clients: [{ ...status.clients[0]!, controlExpiresInMs: Math.max(0, 100 - clock) }],
      }),
    );
    owned = { ...owned, authority: grants.capture('session', 'client', true)! };
    let finish!: () => void;
    let wires = 0;
    canonical.frame.mockImplementation(async (owner: MachineExecutionOwner) => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      owner.assertCurrent?.();
      wires++;
      return true;
    });
    const preparing = executeMachineOperation(
      {
        command: 'frame_job',
        args: { expectedRevision: 'revision', requestId: crypto.randomUUID() },
      },
      owned,
      context,
    );
    const rejected = expect(preparing).rejects.toThrow();
    clock = 101;
    await vi.advanceTimersByTimeAsync(100);
    finish();
    await rejected;
    expect(wires).toBe(0);
    grants.dispose();
  });

  it('a pre-reviewed transient permit cannot start from a remote review request alone', async () => {
    const permit = await framedRunPermitForCurrentState();
    const transient = {
      ...permit,
      candidate: { ...permit.candidate, authorizationContext: 'transient-camera' as const },
    };
    useLaserStore.setState({ completedFrame: transient });
    await expect(
      executeMachineOperation(
        {
          command: 'review_machine_job',
          args: { expectedRevision: 'revision', requestId: crypto.randomUUID() },
        },
        owned,
        context,
      ),
    ).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(canonical.start).not.toHaveBeenCalled();
  });

  it.each(['unconfirmed', 'replacement'] as const)(
    'fulfilled Abort with %s evidence remains an unknown software-stop outcome',
    async (outcome) => {
      useLaserStore.setState({
        stopJob: vi.fn(async () => {
          if (outcome === 'replacement')
            useLaserStore.setState((state) => ({
              controllerSessionEpoch: state.controllerSessionEpoch + 1,
              statusSequence: state.statusSequence + 1,
            }));
        }),
      });
      await executeMachineOperation(
        { command: 'abort_job', args: { requestId: crypto.randomUUID() } },
        owned,
        context,
      );
      expect(owned).toMatchObject({ state: 'unknown', committed: null });
    },
  );

  it('Abort completion requires owned fresh Idle evidence and states software handling', async () => {
    useLaserStore.setState({
      stopJob: vi.fn(async () => {
        useLaserStore.setState((state) => ({ statusSequence: state.statusSequence + 1 }));
      }),
    });
    await executeMachineOperation(
      { command: 'abort_job', args: { requestId: crypto.randomUUID() } },
      owned,
      context,
    );
    expect(owned).toMatchObject({ state: 'completed', committed: true });
    expect(owned.message).toBe('Abort was handled and the controller reports Idle.');
  });
});
