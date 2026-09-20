// Planner starvation: the failure mode on the other side of back-pressure.
//
// `streamer-planner-backpressure.test.ts` proves the sender never OVERRUNS a
// controller that has gone quiet. This file proves the opposite hazard that
// made a Falcon A1 Pro (grblHAL, 512-block planner) stop and restart mid-burn
// (ADR-331): with only the stock 120 bytes in flight — about eight raster
// lines — any acknowledgement round trip longer than those lines' worth of
// motion leaves the planner EMPTY, so the machine decelerates to a stop, and
// then restarts when the next refill lands. A window sized from the
// controller's own receive capacity keeps hundreds of lines buffered and the
// planner never runs dry at the same latency.
//
// grblHAL acks a line as soon as the planner admits it (grblHAL/core
// `protocol.c` reports status after `gc_execute_block` returns, and
// `motion_control.c`'s `mc_line` spins only while the planner is full, which
// eight lines against 512 blocks never reach; read 2026-09-19), so the
// simulated `responseDelayMs` is the pure host + USB round trip. It retires
// one block per `blockRetireMs`; short dithered raster segments take ~1-2 ms
// each at ordinary engraving speeds.
//
// NOT verified by this file: real hardware, real driver latency, or the
// planner's deceleration curve. It demonstrates the mechanism, not the
// Falcon's exact timing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  type GrblSimulator,
} from '../../../__fixtures__/controllers/grbl-simulator';
import {
  DEFAULT_GRBL_RX_BUFFER_BYTES,
  GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
} from '../../grbl-streaming';
import { createStreamer, onAck, step, type StreamerState } from './streamer';

const FALCON_PLANNER_BLOCKS = 512;
// grblHAL's ring far exceeds any window here; the simulator only needs to
// never be the limiting factor.
const SIM_RX_RING_BYTES = 4096;
const LINE_COUNT = 600;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Alternating 13/16-byte `G1 X.. S..` lines — the dithered-raster shape. */
function rasterJob(lineCount: number): string {
  return Array.from(
    { length: lineCount },
    (_, i) => `G1 X${((i + 1) / 10).toFixed(3)} S${i % 2 === 0 ? 0 : 1000}`,
  ).join('\n');
}

type StarvationRun = {
  readonly minBlocks: number;
  readonly maxBlocks: number;
  /** Samples (one per simulated millisecond) at which the planner was empty. */
  readonly emptySamples: number;
  readonly samples: number;
  readonly finished: boolean;
};

async function streamAndSamplePlanner(args: {
  readonly windowBytes: number;
  readonly ackRoundTripMs: number;
  readonly blockRetireMs: number;
}): Promise<StarvationRun> {
  const sim: GrblSimulator = createGrblSimulator({
    emitBannerOnOpen: false,
    plannerBlocks: FALCON_PLANNER_BLOCKS,
    blockRetireMs: args.blockRetireMs,
    rxBufferBytes: SIM_RX_RING_BYTES,
    responseDelayMs: args.ackRoundTripMs,
  });
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });

  let state: StreamerState = createStreamer(rasterJob(LINE_COUNT), {
    rxBufferBytes: args.windowBytes,
  });
  const write = (data: string): void => {
    if (data !== '') void conn.write(data);
  };
  // Mirrors production's advanceStream(): consume the ack, step, write the refill.
  conn.onLine((line) => {
    const kind = line === 'ok' ? 'ok' : line.startsWith('error:') ? 'error' : null;
    if (kind === null) return;
    const stepped = step(onAck(state, kind).state);
    state = stepped.state;
    write(stepped.toSend);
  });
  const first = step(state);
  state = first.state;
  write(first.toSend);

  // Let the first window land and the planner fill before judging occupancy.
  await vi.advanceTimersByTimeAsync(50);
  let minBlocks = Number.POSITIVE_INFINITY;
  let maxBlocks = 0;
  let emptySamples = 0;
  let samples = 0;
  // Stop sampling while the tail drains: an emptying planner at the very end
  // of the job is the normal finish, not starvation.
  while (state.status !== 'done' && samples < 20_000) {
    await vi.advanceTimersByTimeAsync(1);
    const blocks = sim.planner().blocks;
    minBlocks = Math.min(minBlocks, blocks);
    maxBlocks = Math.max(maxBlocks, blocks);
    if (blocks === 0) emptySamples += 1;
    samples += 1;
  }
  return { minBlocks, maxBlocks, emptySamples, samples, finished: state.status === 'done' };
}

describe('grbl streamer planner starvation (ADR-331)', () => {
  it('drains a 512-block planner through the stock 120-byte window at a 16 ms ack round trip', async () => {
    const run = await streamAndSamplePlanner({
      windowBytes: DEFAULT_GRBL_RX_BUFFER_BYTES,
      ackRoundTripMs: 16,
      blockRetireMs: 2,
    });
    expect(run.finished).toBe(true);
    // Eight 13/16-byte lines fit in 120 bytes; the planner never holds more.
    expect(run.maxBlocks).toBeLessThanOrEqual(8);
    expect(run.minBlocks).toBe(0);
    // Stop-and-go: a meaningful share of the burn is spent with nothing to cut.
    expect(run.emptySamples / run.samples).toBeGreaterThan(0.05);
  });

  it('keeps the planner fed through the grblHAL 1024-byte window at the same latency', async () => {
    const run = await streamAndSamplePlanner({
      windowBytes: GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
      ackRoundTripMs: 16,
      blockRetireMs: 2,
    });
    expect(run.finished).toBe(true);
    expect(run.emptySamples).toBe(0);
    expect(run.minBlocks).toBeGreaterThan(100);
  });

  it('still starves the stock window at faster raster segments and a shorter round trip', async () => {
    const starved = await streamAndSamplePlanner({
      windowBytes: DEFAULT_GRBL_RX_BUFFER_BYTES,
      ackRoundTripMs: 8,
      blockRetireMs: 1,
    });
    const fed = await streamAndSamplePlanner({
      windowBytes: GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
      ackRoundTripMs: 8,
      blockRetireMs: 1,
    });
    expect(starved.minBlocks).toBe(0);
    expect(starved.emptySamples).toBeGreaterThan(0);
    expect(fed.emptySamples).toBe(0);
  });
});
