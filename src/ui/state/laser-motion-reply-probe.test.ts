// Regression tests for ADR-696: a cancelled jog whose line grblHAL discarded
// unread is released in place by one ordered `$G`, instead of waiting for a
// Disconnect whose soft reset clears a G92 origin.
//
// The oracle is the simulated firmware. With `jogCancelFlushesInput` the
// simulator discards every line it has not read when 0x85 arrives, as grblHAL
// does (grblHAL/core protocol.c, `hal.stream.cancel_read_buffer()`), and
// `lineParseDelayMs` keeps its main loop busy past Cancel's 500 ms reply grace,
// so the jog line is still unread when the byte goes out. Its reply never
// comes. GRBL, grblHAL and FluidNC answer each line before reading the next and
// print `$G`'s `[GC:...]` before its `ok`.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { jogFrameCommandBlockMessage, setupCommandBlockMessage } from './laser-store-helpers';
import { motionOwnerAwaitsMissingReply } from './laser-motion-release';
import {
  dropUntrackedAcksAheadOf,
  reserveUntrackedAcks,
  type UntrackedAckLedgerRefs,
} from './laser-untracked-ack-ledger';
import { resetStore } from './test-helpers';

const SOFT_RESET = '\x18';
const JOG_CANCEL = '\x85';
const PROBE = '$G\n';
const JOG_LINE = '$J=G91 G21 X50.000 F1000\n';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    lastError: null,
    lastWriteError: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    pendingUntrackedAcks: 0,
    pendingTransportWrites: 0,
    frameVerification: null,
    framedRun: null,
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A board that greets as stock GRBL but flushes unread input on 0x85, as a
 *  grblHAL board on a GRBL profile does (audit HF-8), with a busy main loop. */
async function connectBusyFlushingBoard(): Promise<GrblSimulator> {
  const sim = createGrblSimulator({
    jogCancelFlushesInput: true,
    lineParseDelayMs: 600,
    motionMs: 2_000,
  });
  await useLaserStore.getState().connect(sim.adapter);
  await pump(6_000);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  expect(useLaserStore.getState().motionOperation).toBeNull();
  expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  return sim;
}

/** Jogs, cancels at once, and returns Cancel's failure message. */
async function strandJogOwner(sim: GrblSimulator): Promise<number> {
  const before = sim.outbound().length;
  const jog = useLaserStore
    .getState()
    .jog({ dx: 50, feed: 1000 })
    .catch(() => undefined);
  for (let tick = 0; tick < 40; tick += 1) await Promise.resolve();
  expect(sim.outbound().slice(before)).toContain(JOG_LINE);
  const cancel = useLaserStore
    .getState()
    .cancelJog()
    .then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  await pump(9_000);
  await jog;
  // The byte went out after the grace and discarded the unread jog line.
  expect(await cancel).toMatch(/did not answer the last motion command/);
  expect(sim.state().mpos.x).toBe(0);
  expect(sim.state().machine).toBe('Idle');
  return before;
}

describe('a cancelled jog whose line the controller discarded unread (ADR-696)', () => {
  it('is released in place after one $G, without a reset or Disconnect', async () => {
    const sim = await connectBusyFlushingBoard();
    const before = await strandJogOwner(sim);
    const stranded = useLaserStore.getState();
    expect(stranded.motionOperation).toMatchObject({ cancelRequested: true });

    await pump(6_000);

    const after = sim.outbound().slice(before);
    const state = useLaserStore.getState();
    // Exactly one probe, written after the byte that discarded the jog. `$G`
    // is a setup-only `$` line, which only an active job refuses.
    expect(after.filter((write) => write === PROBE)).toHaveLength(1);
    expect(after.indexOf(PROBE)).toBeGreaterThan(after.indexOf(JOG_CANCEL));
    expect(state.pendingUntrackedAcks).toBe(0);
    expect(state.motionOperation).toBeNull();
    expect(motionOwnerAwaitsMissingReply(state)).toBe(false);
    expect(jogFrameCommandBlockMessage(state)).toBeNull();
    expect(setupCommandBlockMessage(state)).toBeNull();
    expect(state.connection.kind).toBe('connected');
    expect(sim.outbound()).not.toContain(SOFT_RESET);
    expect(state.log.some((line) => line.includes('discarded unread'))).toBe(true);

    // The operator can jog again on the same session.
    await useLaserStore.getState().jog({ dx: -5, feed: 1000 });
    expect(sim.outbound()).toContain('$J=G91 G21 X-5.000 F1000\n');
  }, 30_000);

  it('keeps Disconnect available until the proof arrives', async () => {
    const sim = await connectBusyFlushingBoard();
    await strandJogOwner(sim);
    // Cancel's failure lands while the controller is Idle; the probe waits
    // for 1 s of Idle and the busy main loop answers it 600 ms later.
    expect(motionOwnerAwaitsMissingReply(useLaserStore.getState())).toBe(true);
    await pump(6_000);
    expect(useLaserStore.getState().motionOperation).toBeNull();
  }, 30_000);
});

describe('dropUntrackedAcksAheadOf', () => {
  function ledger(...writes: ReadonlyArray<ReadonlyArray<string>>): UntrackedAckLedgerRefs {
    const refs: UntrackedAckLedgerRefs = { writeEpoch: 1 };
    for (const lines of writes) reserveUntrackedAcks(refs, lines.length, null, lines);
    return refs;
  }
  const isProbe = (line: string): boolean => line === '$G';

  it('drops only the writes before the oldest $G and returns the replies they owed', () => {
    const refs = ledger(['$J=G91 X1 F100'], ['G4 P0', 'M5'], ['$G'], ['G21']);
    expect(dropUntrackedAcksAheadOf(refs, isProbe)).toBe(3);
    expect(refs.untrackedAckReservations?.map((r) => r.lines)).toEqual([['$G'], ['G21']]);
  });

  it('a $G answered first drops nothing', () => {
    const refs = ledger(['$G'], ['$J=G91 X1 F100']);
    expect(dropUntrackedAcksAheadOf(refs, isProbe)).toBe(0);
    expect(refs.untrackedAckReservations).toHaveLength(2);
  });

  it('drops nothing when no write holds a $G', () => {
    const refs = ledger(['$J=G91 X1 F100']);
    expect(dropUntrackedAcksAheadOf(refs, isProbe)).toBe(0);
    expect(refs.untrackedAckReservations).toHaveLength(1);
  });
});
