// ADR-395 Amendment 1 (controller audit v2 C6-P2-2): a move Marlin skipped and
// still answered `ok` stops whatever sent it. Store-level runs through the
// simulator are in src/ui/laser/marlin-home-first.test.ts.
import { describe, expect, it, vi } from 'vitest';
import { marlinDriver } from '../../core/controllers';
import { ControllerCommandRefusedError, startControllerCommand } from './laser-interactive-command';
import { handleLine } from './laser-line-handler';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { reserveUntrackedAcks } from './laser-untracked-ack-ledger';

const STOPPED =
  'Printer stopped due to errors. Fix the error and use M999 to restart. ' +
  '(Temperature is reset. Set it after restarting)';

function marlinHarness() {
  const harness = makeLineHandlerHarness();
  harness.refs.driver = marlinDriver;
  harness.set({ capabilities: marlinDriver.capabilities, activeControllerKind: 'marlin' });
  return { ...harness, safeWrite: vi.fn(async () => undefined) };
}

function frameAfterPoll(h: ReturnType<typeof marlinHarness>): void {
  // An M114 poll is still owed when the Frame's leg goes out behind it.
  h.set({
    pendingUntrackedAcks: 2,
    motionOperation: {
      operationId: 9,
      kind: 'frame',
      sawControllerBusy: false,
      idleStatusReports: 0,
      dispatchComplete: true,
      pendingLines: [],
    },
  });
  reserveUntrackedAcks(h.refs, 1, null);
  reserveUntrackedAcks(h.refs, 1, 9);
}

describe('a stopped Marlin', () => {
  // queue.cpp prints the notice when it READS a move, so it can arrive before
  // an earlier line's ok. Every later move is skipped as well.
  it('stops the running Frame even when an earlier line still owes its ok', () => {
    const h = marlinHarness();
    frameAfterPoll(h);

    handleLine(h.set, h.get, h.refs, h.safeWrite, STOPPED);

    expect(h.get().motionOperation).toMatchObject({ operationId: 9, cancelRequested: true });
    expect(h.get().pendingUntrackedAcks).toBe(2);
    expect(h.get().safetyNotice?.message).toContain('KerfDesk stopped the Frame');
  });

  it('keeps an ordinary handler error tied to the line it answers', () => {
    const h = marlinHarness();
    frameAfterPoll(h);

    handleLine(h.set, h.get, h.refs, h.safeWrite, 'Error:G2/G3 bad parameters');

    expect(h.get().motionOperation?.cancelRequested).not.toBe(true);
  });
});

describe('an owned move Marlin skipped', () => {
  it('is refused with the plain reason on the ok that follows the echo', async () => {
    const h = marlinHarness();
    const command = startControllerCommand(h.refs, async () => undefined, {
      kind: 'interactive-command',
      label: 'Move',
      command: 'G0 X10\n',
    });
    await Promise.resolve();
    handleLine(h.set, h.get, h.refs, h.safeWrite, 'echo:Home XYZ First');
    expect(h.refs.controllerCommand).not.toBeNull();
    handleLine(h.set, h.get, h.refs, h.safeWrite, 'ok');
    await expect(command).rejects.toBeInstanceOf(ControllerCommandRefusedError);
    await expect(command).rejects.toThrow(
      'The controller skipped a move because its firmware does not move until X, Y and Z are homed',
    );
  });
});
