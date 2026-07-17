import { describe, expect, it, vi } from 'vitest';
import { grblDriver, marlinDriver } from '../../core/controllers';
import { requestActiveWcsReadback } from './active-wcs-readback';
import type { LaserState } from './laser-store';

const QUALIFIED_EPOCH = 3;

function stateWith(overrides: Partial<LaserState>): () => LaserState {
  // Only the fields the helper reads matter; the rest of LaserState is
  // irrelevant to this unit, so a partial stands in for the full store shape.
  const state = {
    controllerSessionEpoch: QUALIFIED_EPOCH,
    controllerQualification: { kind: 'qualified', epoch: QUALIFIED_EPOCH, settings: 'verified' },
    pendingUntrackedAcks: 0,
    ...overrides,
  } as LaserState;
  return () => state;
}

describe('requestActiveWcsReadback', () => {
  it('issues the modal query as a normal system write against a qualified, quiescent session', async () => {
    const write = vi.fn(async () => undefined);
    await requestActiveWcsReadback(stateWith({}), grblDriver, write, QUALIFIED_EPOCH);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('$G\n', undefined, 'system');
  });

  it('skips controllers without a modal-state query', async () => {
    const write = vi.fn(async () => undefined);
    await requestActiveWcsReadback(stateWith({}), marlinDriver, write, QUALIFIED_EPOCH);
    expect(write).not.toHaveBeenCalled();
  });

  it('skips a stale session epoch', async () => {
    const write = vi.fn(async () => undefined);
    await requestActiveWcsReadback(
      stateWith({ controllerSessionEpoch: QUALIFIED_EPOCH + 1 }),
      grblDriver,
      write,
      QUALIFIED_EPOCH,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('skips when qualification is not current for the expected epoch', async () => {
    const write = vi.fn(async () => undefined);
    await requestActiveWcsReadback(
      stateWith({
        controllerQualification: { kind: 'failed', epoch: QUALIFIED_EPOCH, message: 'nope' },
      }),
      grblDriver,
      write,
      QUALIFIED_EPOCH,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('skips a non-quiescent untracked-ack ledger (F1)', async () => {
    const write = vi.fn(async () => undefined);
    await requestActiveWcsReadback(
      stateWith({ pendingUntrackedAcks: 1 }),
      grblDriver,
      write,
      QUALIFIED_EPOCH,
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('swallows a write failure — the readback is advisory-only', async () => {
    const write = vi.fn(async () => {
      throw new Error('port gone');
    });
    await expect(
      requestActiveWcsReadback(stateWith({}), grblDriver, write, QUALIFIED_EPOCH),
    ).resolves.toBeUndefined();
  });
});
