import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UNRESTRICTED_EDITION, setActiveEdition } from '../licensing/edition';
import {
  registerBoardRemote,
  type BoardRemoteController,
  type BoardRemoteStatus,
} from '../laser/board-capture/board-capture-remote';
import { useStore } from '../state/store';
import { resultCode, testAdapter, writeArgs } from './authoring-test-support';
import type { MachineAuthority, MachineOperation } from './machine-types';
import type { RemoteCommandResult, RemoteControlAdapter } from './types';

let adapter: RemoteControlAdapter;
let authorityController: AbortController;
let unregister: (() => void) | null = null;

beforeEach(() => {
  useStore.setState(useStore.getInitialState(), true);
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
  await vi.waitFor(async () => {
    const receipt = operation(
      await adapter.execute('get_control_operation', { operationId: args.requestId }),
    );
    expect(receipt.state).not.toBe('accepted');
    expect(receipt.state).not.toBe('running');
  });
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
    unregister = registerBoardRemote({
      status: () => status(captures),
      capture: async () => {
        captures = 1;
      },
      finish: async () => undefined,
    });
    const receipt = await completedOperation('capture_board_point');
    expect(receipt).toMatchObject({
      state: 'completed',
      committed: true,
      message: 'Captured point 1 of 2.',
    });
  });

  it('retains a controller rejection message', async () => {
    const controller: BoardRemoteController = {
      status: () => status(0),
      capture: () => Promise.reject(new Error('Move the head onto anchor A first.')),
      finish: async () => undefined,
    };
    unregister = registerBoardRemote(controller);
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
      unregister = registerBoardRemote({ status: () => status(2), capture, finish });
      const receipt = await completedOperation(command);
      expect(receipt).toMatchObject({ state: 'failed', message: expect.stringMatching(/Pro/) });
      expect(capture).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    },
  );

  it('refuses a busy panel before it runs', async () => {
    const capture = vi.fn(async () => undefined);
    unregister = registerBoardRemote({
      status: () => ({ ...status(0), busy: true }),
      capture,
      finish: async () => undefined,
    });
    const receipt = await completedOperation('capture_board_point');
    expect(receipt).toMatchObject({
      state: 'failed',
      message: 'Place Board is busy on the computer. Wait, then try again.',
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('refuses stale capture coordinates before remote finish invokes the panel', async () => {
    const finish = vi.fn(async () => undefined);
    unregister = registerBoardRemote({
      status: () => ({ ...status(2), coordinatesCurrent: false }),
      capture: vi.fn(async () => undefined),
      finish,
    });
    const receipt = await completedOperation('finish_board');
    expect(receipt.state).toBe('failed');
    expect(receipt.message).toContain('coordinates changed');
    expect(finish).not.toHaveBeenCalled();
  });

  it('completes finish with the Frame reminder', async () => {
    unregister = registerBoardRemote({
      status: () => status(2),
      capture: async () => undefined,
      finish: async () => undefined,
    });
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
    unregister = registerBoardRemote({
      status: () => status(0),
      capture: async () => undefined,
      finish: async () => undefined,
    });
    const receipt = await completedOperation('capture_board_point');
    expect(receipt.state).toBe('failed');
    expect(receipt.message).toContain('Pro');
  });
});
