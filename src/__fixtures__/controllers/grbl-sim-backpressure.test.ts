// Tests the measuring instrument first (ADR-025 discipline). Everything the
// streamer proofs claim rests on this file: that the simulator really does go
// quiet when its planner fills, really does pile host bytes up in the RX ring,
// and really does stay abortable while stalled.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import { createGrblSimulator, type CreateGrblSimulatorOptions } from './grbl-simulator';
import { rxBytesInUse } from './grbl-sim-rx-window';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function openSim(options: CreateGrblSimulatorOptions = {}): Promise<{
  readonly sim: ReturnType<typeof createGrblSimulator>;
  readonly conn: SerialConnection;
  readonly lines: string[];
}> {
  const sim = createGrblSimulator({ emitBannerOnOpen: false, ...options });
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });
  const lines: string[] = [];
  conn.onLine((l) => lines.push(l));
  return { sim, conn, lines };
}

const FOUR_MOVES = 'G1 X1 F600\nG1 X2 F600\nG1 X3 F600\nG1 X4 F600\n';

describe('grbl-sim back-pressure', () => {
  it('stays opt-in: without plannerBlocks every line is still acked at once', async () => {
    const { sim, conn, lines } = await openSim();
    await conn.write(FOUR_MOVES.repeat(10));
    await pump(5);
    expect(lines.filter((l) => l === 'ok')).toHaveLength(40);
    // The meters are inert, so a test that forgot to opt in cannot silently
    // read a zero and believe it proved something.
    expect(sim.rxWindow().capacity).toBe(0);
    expect(sim.planner().capacity).toBe(0);
  });

  it('withholds the ack once the planner is full, and queues the rest in the ring', async () => {
    const { sim, conn, lines } = await openSim({ plannerBlocks: 2, blockRetireMs: 100 });
    await conn.write(FOUR_MOVES);
    await pump(5);
    expect(lines.filter((l) => l === 'ok')).toHaveLength(2);
    expect(sim.planner().blocks).toBe(2);
    expect(sim.planner().withheldAck).toBe('G1 X3 F600');
    // The fourth line was never read: the main loop is stuck in mc_line().
    expect(rxBytesInUse(sim.rxWindow())).toBe('G1 X4 F600\n'.length);
    expect(sim.rxWindow().droppedBytes).toBe(0);
  });

  it('releases exactly one withheld ack per retiring block', async () => {
    const { sim, conn, lines } = await openSim({ plannerBlocks: 2, blockRetireMs: 100 });
    await conn.write(FOUR_MOVES);
    await pump(5);
    await pump(100);
    expect(lines.filter((l) => l === 'ok')).toHaveLength(3);
    expect(sim.planner().withheldAck).toBe('G1 X4 F600');
    await pump(100);
    expect(lines.filter((l) => l === 'ok')).toHaveLength(4);
    await pump(400);
    expect(sim.planner().blocks).toBe(0);
    expect(sim.state().machine).toBe('Idle');
  });

  it('answers ? while the main loop is blocked — a stalled job stays observable', async () => {
    const { sim, conn, lines } = await openSim({ plannerBlocks: 2, blockRetireMs: 1000 });
    await conn.write(FOUR_MOVES);
    await pump(5);
    expect(sim.planner().withheldAck).not.toBeNull();
    lines.length = 0;
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toMatch(/^<Run\|/);
  });

  it('soft reset during a stall clears the planner and the ring — Abort still works', async () => {
    const { sim, conn, lines } = await openSim({ plannerBlocks: 2, blockRetireMs: 1000 });
    await conn.write(FOUR_MOVES);
    await pump(5);
    expect(sim.planner().withheldAck).not.toBeNull();
    lines.length = 0;
    await conn.write('\x18');
    await pump(5);
    expect(lines).toContain('ALARM:3');
    expect(sim.planner().blocks).toBe(0);
    expect(sim.planner().withheldAck).toBeNull();
    expect(rxBytesInUse(sim.rxWindow())).toBe(0);
  });

  it('non-motion lines behind a stalled motion line wait, then ack in order', async () => {
    const { sim, conn, lines } = await openSim({ plannerBlocks: 1, blockRetireMs: 100 });
    await conn.write('G1 X1 F600\nG1 X2 F600\nM5\n');
    await pump(5);
    expect(lines.filter((l) => l === 'ok')).toHaveLength(1);
    expect(rxBytesInUse(sim.rxWindow())).toBe('M5\n'.length);
    await pump(100);
    // The freed slot releases X2's ack and lets the main loop read M5.
    expect(lines.filter((l) => l === 'ok')).toHaveLength(3);
    expect(sim.rxWindow().droppedBytes).toBe(0);
  });

  it('drops bytes when a sender ignores back-pressure — the meter really fires', async () => {
    // Negative control. If this did not overrun, the streamer proofs next door
    // would be vacuous: a ring that never drops proves nothing about one that can.
    const { sim, conn } = await openSim({
      plannerBlocks: 2,
      blockRetireMs: 1000,
      rxBufferBytes: 127,
    });
    await conn.write(FOUR_MOVES.repeat(20));
    await pump(5);
    expect(sim.rxWindow().droppedBytes).toBeGreaterThan(0);
    expect(sim.rxWindow().peakBytes).toBeLessThanOrEqual(127);
  });
});
