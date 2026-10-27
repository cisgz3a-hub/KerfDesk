import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import { UNRESTRICTED_EDITION, setActiveEdition } from '../licensing/edition';
import { boardCaptureBlockMessage } from '../laser/board-capture/board-capture-gate';
import {
  registerBoardRemote,
  type BoardRemoteController,
  type BoardRemoteStatus,
} from '../laser/board-capture/board-capture-remote';
import { startMotionOperation } from '../state/laser-motion-operation';
import { useLaserStore } from '../state/laser-store';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import { NO_FRESH_BOARD_REPORT_MESSAGE } from './machine-board-fresh-report';
import type { MachineAuthority, MachineOperation } from './machine-types';
import type { RemoteCommandResult, RemoteControlAdapter } from './types';

const originalLaserState = useLaserStore.getState();
let adapter: RemoteControlAdapter;
let authorityController: AbortController;
let unregister: (() => void) | null = null;

function report(state: StatusReport['state'], x = 10, y = 10): StatusReport {
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

/** The controller answers each status query with this report, as a new sequence. */
function answerStatusQueriesWith(next: () => StatusReport | null): void {
  useLaserStore.setState({
    requestControllerStatus: vi.fn(async () => {
      const answer = next();
      if (answer === null) return;
      useLaserStore.setState((state) => ({
        statusReport: answer,
        statusSequence: state.statusSequence + 1,
      }));
    }),
  });
}

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: report('Idle'),
    statusSequence: 1,
    wcoCache: null,
  });
  answerStatusQueriesWith(() => report('Idle'));
  setActiveEdition(UNRESTRICTED_EDITION);
  authorityController = new AbortController();
  const authority: MachineAuthority = {
    clientId: 'board-client',
    sessionId: 'board-session',
    signal: authorityController.signal,
    assertCurrent: () => authorityController.signal.throwIfAborted(),
  };
  adapter = testAdapter({
    canWrite: () => false,
    getRemoteCaller: () => ({
      clientId: authority.clientId,
      sessionId: authority.sessionId,
    }),
    captureMachineAuthority: () => authority,
  });
});

afterEach(() => {
  unregister?.();
  unregister = null;
  adapter.dispose();
  authorityController.abort();
  setActiveEdition(null);
  useLaserStore.setState(originalLaserState, true);
});

function operation(result: RemoteCommandResult): MachineOperation {
  if (!result.ok) throw new Error(result.error.code);
  return result.data['operation'] as MachineOperation;
}

async function completedOperation(
  command: 'capture_board_point' | 'finish_board',
): Promise<MachineOperation> {
  const args = writeArgs(adapter);
  expect(resultCode(await adapter.execute(command, args))).toBe('ok');
  await vi.waitFor(
    async () => {
      const receipt = operation(
        await adapter.execute('get_control_operation', { operationId: args.requestId }),
      );
      expect(receipt.state).not.toBe('accepted');
      expect(receipt.state).not.toBe('running');
    },
    { timeout: 4_000 },
  );
  return operation(await adapter.execute('get_control_operation', { operationId: args.requestId }));
}

function status(captures: number): BoardRemoteStatus {
  return {
    panelOpen: true,
    shape: 'outline',
    committed: false,
    captures,
    capturesNeeded: 2,
    hasOutlineDraft: true,
    coordinatesCurrent: true,
    busy: false,
    board: null,
  };
}

function controller(overrides: Partial<BoardRemoteController> = {}): BoardRemoteController {
  return {
    status: () => status(0),
    finishReview: () => ({ refusal: null, notice: null }),
    capture: async () => undefined,
    finish: async () => undefined,
    ...overrides,
  };
}

describe('Place Board machine controls', () => {
  it('fails with a useful message when Place Board is not open', async () => {
    const receipt = await completedOperation('capture_board_point');
    expect(receipt).toMatchObject({
      state: 'failed',
      message: 'Open Place Board on the computer first.',
    });
  });

  it('completes capture with the post-capture count', async () => {
    let captures = 0;
    unregister = registerBoardRemote(
      controller({
        status: () => status(captures),
        capture: async () => {
          captures = 1;
        },
      }),
    );
    const receipt = await completedOperation('capture_board_point');
    expect(receipt).toMatchObject({
      state: 'completed',
      committed: true,
      message: 'Captured point 1 of 2.',
    });
  });

  it('retains a controller rejection message', async () => {
    unregister = registerBoardRemote(
      controller({
        capture: () => Promise.reject(new Error('Move the head onto anchor A first.')),
      }),
    );
    const receipt = await completedOperation('capture_board_point');
    // The panel ran, so a work origin may have been written: the outcome is unknown, not failed.
    expect(receipt).toMatchObject({
      state: 'unknown',
      message: 'Move the head onto anchor A first.',
    });
  });

  it.each(['capture_board_point', 'finish_board'] as const)(
    'refuses %s without Pro before the panel runs',
    async (command) => {
      setActiveEdition({ ...UNRESTRICTED_EDITION, licensed: true, pro: false });
      const capture = vi.fn(async () => undefined);
      const finish = vi.fn(async () => undefined);
      unregister = registerBoardRemote(controller({ status: () => status(2), capture, finish }));
      const receipt = await completedOperation(command);
      expect(receipt).toMatchObject({ state: 'failed', message: expect.stringMatching(/Pro/) });
      expect(capture).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    },
  );

  it('refuses a busy panel before it runs', async () => {
    const capture = vi.fn(async () => undefined);
    unregister = registerBoardRemote(
      controller({ status: () => ({ ...status(0), busy: true }), capture }),
    );
    const receipt = await completedOperation('capture_board_point');
    expect(receipt).toMatchObject({
      state: 'failed',
      message: 'Place Board is busy on the computer. Wait, then try again.',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses stale capture coordinates before remote finish invokes the panel', async () => {
    const finish = vi.fn(async () => undefined);
    unregister = registerBoardRemote(
      controller({ status: () => ({ ...status(2), coordinatesCurrent: false }), finish }),
    );
    const receipt = await completedOperation('finish_board');
    expect(receipt.state).toBe('failed');
    expect(receipt.message).toContain('coordinates changed');
    expect(finish).not.toHaveBeenCalled();
  });

  it('completes finish with the Frame reminder', async () => {
    unregister = registerBoardRemote(controller({ status: () => status(2) }));
    const receipt = await completedOperation('finish_board');
    expect(receipt).toMatchObject({
      state: 'completed',
      message: 'Board created. Check every anchor on the computer, then Frame before Start.',
    });
  });

  it('requires Pro', async () => {
    setActiveEdition({
      ...UNRESTRICTED_EDITION,
      pro: false,
      requestPro: () => false,
    });
    unregister = registerBoardRemote(controller());
    const receipt = await completedOperation('capture_board_point');
    expect(receipt.state).toBe('failed');
    expect(receipt.message).toContain('Pro');
  });
});

describe('Place Board remote capture keeps the PC Capture gate (ADR-654 Amendment 1)', () => {
  it.each(['capture_board_point', 'finish_board'] as const)(
    'refuses %s during a PC jog with the reason the PC Capture button shows',
    async (command) => {
      useLaserStore.setState({
        motionOperation: startMotionOperation('jog'),
        statusReport: report('Jog', 10, 14),
      });
      const pcReason = boardCaptureBlockMessage(useLaserStore.getState());
      expect(pcReason).not.toBeNull();
      const capture = vi.fn(async () => undefined);
      const finish = vi.fn(async () => undefined);
      unregister = registerBoardRemote(controller({ status: () => status(1), capture, finish }));

      const receipt = await completedOperation(command);

      expect(receipt).toMatchObject({ state: 'failed', committed: false, message: pcReason });
      expect(capture).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    },
  );

  it('captures at Idle only after a status report newer than the request', async () => {
    let sequenceAtCapture = -1;
    const capture = vi.fn(async () => {
      sequenceAtCapture = useLaserStore.getState().statusSequence;
    });
    unregister = registerBoardRemote(controller({ capture }));

    const receipt = await completedOperation('capture_board_point');

    expect(receipt.state).toBe('completed');
    expect(useLaserStore.getState().requestControllerStatus).toHaveBeenCalled();
    expect(sequenceAtCapture).toBeGreaterThan(1);
  });

  it('refuses when the fresh report shows the head moving after an Idle one', async () => {
    // The last report said Idle, but an MPG the PC does not own is already turning.
    answerStatusQueriesWith(() => report('Jog', 12, 10));
    const capture = vi.fn(async () => undefined);
    unregister = registerBoardRemote(controller({ capture }));

    const receipt = await completedOperation('capture_board_point');

    expect(receipt.state).toBe('failed');
    expect(receipt.message).toMatch(/Idle/);
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses when no new report arrives', async () => {
    answerStatusQueriesWith(() => null);
    const capture = vi.fn(async () => undefined);
    unregister = registerBoardRemote(controller({ capture }));

    const receipt = await completedOperation('capture_board_point');

    expect(receipt).toMatchObject({ state: 'failed', message: NO_FRESH_BOARD_REPORT_MESSAGE });
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses when the computer records a point while the report is awaited', async () => {
    let captures = 0;
    answerStatusQueriesWith(() => {
      captures = 1;
      return report('Idle');
    });
    const capture = vi.fn(async () => undefined);
    unregister = registerBoardRemote(controller({ status: () => status(captures), capture }));

    const receipt = await completedOperation('capture_board_point');

    expect(receipt).toMatchObject({
      state: 'failed',
      message: 'Place Board changed on the computer. Check it, then try again.',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses finish where the PC shows a warning before Finish', async () => {
    const finish = vi.fn(async () => undefined);
    unregister = registerBoardRemote(
      controller({
        status: () => status(2),
        finishReview: () => ({ refusal: 'The corners are 8 mm off.', notice: null }),
        finish,
      }),
    );

    const receipt = await completedOperation('finish_board');

    expect(receipt).toMatchObject({ state: 'failed', message: 'The corners are 8 mm off.' });
    expect(finish).not.toHaveBeenCalled();
  });

  it('carries the note the PC shows with the created board', async () => {
    unregister = registerBoardRemote(
      controller({
        status: () => status(2),
        finishReview: () => ({ refusal: null, notice: 'The head measured the board 2.0% larger.' }),
      }),
    );

    const receipt = await completedOperation('finish_board');

    expect(receipt).toMatchObject({
      state: 'completed',
      message:
        'Board created. The head measured the board 2.0% larger. Check every anchor on the computer, then Frame before Start.',
    });
  });
});
