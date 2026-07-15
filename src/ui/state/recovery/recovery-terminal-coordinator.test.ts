import { describe, expect, it, vi } from 'vitest';
import type { RecoveryRepositoryResult } from './recovery-model';
import {
  RecoveryTerminalCoordinator,
  type PendingRecoveryTerminal,
} from './recovery-terminal-coordinator';

const TERMINAL: PendingRecoveryTerminal = {
  kind: 'completed',
  completedAtIso: '2026-07-15T10:00:00.000Z',
};

describe('RecoveryTerminalCoordinator', () => {
  it('reports deferred terminal persistence failure from activation', async () => {
    const coordinator = new RecoveryTerminalCoordinator();
    coordinator.noteStaged('run-tiny');
    const persist = vi
      .fn<() => Promise<RecoveryRepositoryResult<boolean>>>()
      .mockResolvedValueOnce({ ok: true, value: false })
      .mockResolvedValueOnce({ ok: true, value: false })
      .mockResolvedValueOnce({ ok: false, error: 'storage-unavailable' })
      .mockResolvedValueOnce({ ok: false, error: 'storage-unavailable' });

    expect(await coordinator.settleOrDefer('run-tiny', TERMINAL, persist, () => true)).toEqual({
      ok: true,
      value: true,
    });
    expect(
      await coordinator.finishActivation('run-tiny', { ok: true, value: true }, persist),
    ).toEqual({ ok: false, error: 'storage-unavailable' });
    expect(persist).toHaveBeenCalledTimes(4);
  });

  it('reports a deferred terminal ownership conflict instead of masking it as activation success', async () => {
    const coordinator = new RecoveryTerminalCoordinator();
    coordinator.noteStaged('run-tiny');
    const persist = vi
      .fn<() => Promise<RecoveryRepositoryResult<boolean>>>()
      .mockResolvedValue({ ok: true, value: false });

    await coordinator.settleOrDefer('run-tiny', TERMINAL, persist, () => true);
    expect(
      await coordinator.finishActivation('run-tiny', { ok: true, value: true }, persist),
    ).toEqual({ ok: true, value: false });
  });
});
