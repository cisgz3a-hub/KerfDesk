import { describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { SerialConnection } from '../../platform/types';
import {
  beginJobTransportWrite,
  bindLiveJobTransportLedger,
  jobTransportWritesInFlight,
  settleJobTransportWrite,
} from './laser-job-transport-ledger';
import { createSafeWrite, type SafeWriteRefs } from './laser-safe-write';
import { hasPendingControllerWrite, pendingTransportWriteCount } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';
import { initialLaserState } from './laser-store-helpers';

type Write = (data: string) => Promise<void>;

function connection(write: Write): SerialConnection {
  return {
    write,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
}

function harness(write: Write) {
  let state = initialLaserState() as LaserState;
  const set = vi.fn(
    (patch: Partial<LaserState> | ((current: LaserState) => Partial<LaserState> | LaserState)) => {
      state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    },
  );
  const refs: SafeWriteRefs = {
    connection: connection(write),
    driver: grblDriver,
    nextTranscriptId: 1,
    writeEpoch: 0,
    untrackedAckReservations: [],
  } as SafeWriteRefs;
  bindLiveJobTransportLedger(refs);
  return { set, refs, get: () => state, safeWrite: createSafeWrite(set, () => state, refs) };
}

function deferred(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('job refill transport ledger (ADR-349)', () => {
  it('keeps a per-ack refill off the store while the fence still sees it in transport', async () => {
    const pending = deferred();
    const { set, get, refs, safeWrite } = harness(() => pending.promise);

    const write = safeWrite('G1X1Y1\n', undefined, 'job');
    expect(set).not.toHaveBeenCalled();
    expect(get().pendingTransportWrites).toBe(0);
    expect(jobTransportWritesInFlight(refs)).toBe(1);
    expect(pendingTransportWriteCount(get())).toBe(1);
    expect(hasPendingControllerWrite(get())).toBe(true);

    pending.resolve();
    await write;
    expect(set).not.toHaveBeenCalled();
    expect(jobTransportWritesInFlight(refs)).toBe(0);
    expect(hasPendingControllerWrite(get())).toBe(false);
  });

  it('still counts a Start window in the store, which the Start boundary reads', async () => {
    const pending = deferred();
    const { set, get, safeWrite } = harness(() => pending.promise);

    const write = safeWrite('G1X1Y1\n', 'start');
    expect(get().pendingTransportWrites).toBe(1);
    pending.resolve();
    await write;
    expect(get().pendingTransportWrites).toBe(0);
    expect(set).toHaveBeenCalledTimes(2);
  });

  it('records a failed refill as a write error without touching the store counter', async () => {
    const { get, refs, safeWrite } = harness(async () => {
      throw new Error('device lost');
    });

    await expect(safeWrite('G1X1Y1\n', undefined, 'job')).rejects.toThrow('device lost');
    expect(jobTransportWritesInFlight(refs)).toBe(0);
    expect(get().pendingTransportWrites).toBe(0);
    expect(get().lastWriteError).toContain('device lost');
  });

  it('forgets refills from a replaced session and ignores their late completion', () => {
    const refs: SafeWriteRefs = { writeEpoch: 3 } as SafeWriteRefs;
    const stale = beginJobTransportWrite(refs);
    beginJobTransportWrite(refs);
    expect(jobTransportWritesInFlight(refs)).toBe(2);

    refs.writeEpoch = 4;
    expect(jobTransportWritesInFlight(refs)).toBe(0);
    const current = beginJobTransportWrite(refs);
    settleJobTransportWrite(refs, stale);
    expect(jobTransportWritesInFlight(refs)).toBe(1);
    settleJobTransportWrite(refs, current);
    settleJobTransportWrite(refs, current);
    expect(jobTransportWritesInFlight(refs)).toBe(0);
  });
});
