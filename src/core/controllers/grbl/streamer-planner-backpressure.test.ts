// The REAL character-counting streamer driven against a GRBL simulator that
// actually stops acking when its planner fills.
//
// Until `grbl-sim-backpressure.ts` existed, the simulator acked instantly, so
// the one failure mode character counting exists to prevent — overrunning the
// controller's receive buffer while it is quiet — was never exercised anywhere
// in this repo. `streamer.test.ts` next door proves the state machine's
// bookkeeping in isolation; this file proves the algorithm survives a
// controller that goes silent mid-job.
//
// The ack→step→write loop below mirrors production's `advanceStream()`
// (`src/ui/state/laser-stream-ack.ts`): consume the ack, step the streamer,
// write whatever refill it returns. Nothing here re-implements flow control.
//
// NOT verified by this file: real hardware. A simulator that now models
// back-pressure is still a model — it does not prove USB-serial latency, an
// FTDI driver's own buffering, or any specific machine's timing.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GRBL_RX_USABLE_BYTES,
  rxBytesInUse,
} from '../../../__fixtures__/controllers/grbl-sim-rx-window';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
  type GrblSimulator,
} from '../../../__fixtures__/controllers/grbl-simulator';
import {
  createStreamer,
  DEFAULT_RX_BUFFER_BYTES,
  onAck,
  step,
  type StreamerState,
} from './streamer';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** Distinct absolute moves, so the final MPos proves every line was executed. */
function motionJob(lineCount: number): string {
  return Array.from({ length: lineCount }, (_, i) => `G1 X${i + 1}.000 Y0.000 F600 S200`).join(
    '\n',
  );
}

type StreamRun = {
  readonly sim: GrblSimulator;
  readonly streamer: () => StreamerState;
  /** Every line the host actually put on the wire, in write order. */
  readonly sentLines: () => ReadonlyArray<string>;
};

async function startStream(
  gcode: string,
  simOptions: CreateGrblSimulatorOptions,
): Promise<StreamRun> {
  const sim = createGrblSimulator({ emitBannerOnOpen: false, ...simOptions });
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });

  let state = createStreamer(gcode, { rxBufferBytes: DEFAULT_RX_BUFFER_BYTES });
  const sent: string[] = [];
  const write = (data: string): void => {
    if (data === '') return;
    for (const line of data.split('\n')) if (line !== '') sent.push(line);
    void conn.write(data);
  };

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
  return { sim, streamer: () => state, sentLines: () => sent };
}

describe('grbl streamer under planner back-pressure', () => {
  it('never overruns the controller RX buffer while acks are stalled', async () => {
    const lineCount = 200;
    const { sim, streamer } = await startStream(motionJob(lineCount), {
      plannerBlocks: 4,
      blockRetireMs: 20,
    });

    // Prove the stall is real first — otherwise the assertions below are vacuous.
    await pump(5);
    expect(sim.planner().withheldAck).not.toBeNull();
    expect(rxBytesInUse(sim.rxWindow())).toBeGreaterThan(0);

    await pump(lineCount * 20 + 500);
    expect(sim.rxWindow().droppedBytes).toBe(0);
    // The sender's own window bounds the ring: a line leaves the ring when the
    // firmware reads it, which always precedes its ack.
    expect(sim.rxWindow().peakBytes).toBeLessThanOrEqual(DEFAULT_RX_BUFFER_BYTES);
    expect(sim.rxWindow().peakBytes).toBeLessThan(GRBL_RX_USABLE_BYTES);
    expect(streamer().status).toBe('done');
  });

  it('makes no progress while the controller is silent, then resumes cleanly', async () => {
    const lineCount = 60;
    const { sim, streamer, sentLines } = await startStream(motionJob(lineCount), {
      plannerBlocks: 3,
      blockRetireMs: 25,
    });

    await pump(5);
    expect(sim.planner().withheldAck).not.toBeNull();
    const stalledAt = streamer().completed;
    expect(stalledAt).toBeGreaterThan(0);
    expect(stalledAt).toBeLessThan(lineCount);

    // Still inside the first block's retire window: the controller owes acks
    // and the streamer must simply wait rather than push more bytes.
    await pump(15);
    expect(streamer().completed).toBe(stalledAt);
    expect(sim.rxWindow().droppedBytes).toBe(0);

    await pump(lineCount * 25 + 500);
    expect(streamer().status).toBe('done');
    expect(streamer().completed).toBe(lineCount);
    expect(sentLines()).toEqual(motionJob(lineCount).split('\n'));
    expect(sim.state().mpos.x).toBe(lineCount);
  });

  it('survives a long stall without deadlocking or dropping a line', async () => {
    const lineCount = 24;
    const { sim, streamer, sentLines } = await startStream(motionJob(lineCount), {
      plannerBlocks: 2,
      blockRetireMs: 1000,
    });

    await pump(5);
    expect(sim.planner().withheldAck).not.toBeNull();

    // Just under a full second of simulated silence — no ack, and critically no
    // overrun: the streamer holds its bytes instead of filling the ring.
    await pump(900);
    expect(sim.rxWindow().droppedBytes).toBe(0);
    expect(sim.rxWindow().peakBytes).toBeLessThanOrEqual(DEFAULT_RX_BUFFER_BYTES);

    await pump(lineCount * 1000 + 2000);
    expect(streamer().status).toBe('done');
    expect(streamer().completed).toBe(lineCount);
    // Every line exactly once, in order: nothing dropped, nothing re-sent.
    expect(sentLines()).toEqual(motionJob(lineCount).split('\n'));
    expect(sim.rxWindow().droppedBytes).toBe(0);
    expect(sim.state().machine).toBe('Idle');
    expect(sim.state().mpos.x).toBe(lineCount);
  });

  it('a sender without character counting overruns the very same controller', async () => {
    // The A/B that makes the three proofs above meaningful: identical job,
    // identical controller, only the flow control removed.
    const sim = createGrblSimulator({
      emitBannerOnOpen: false,
      plannerBlocks: 4,
      blockRetireMs: 20,
    });
    const portRef = await sim.adapter.serial.requestPort();
    if (portRef === null) throw new Error('requestPort returned null');
    const conn = await portRef.open({ baudRate: 115200 });

    await conn.write(`${motionJob(200)}\n`);
    await pump(5);
    expect(sim.rxWindow().droppedBytes).toBeGreaterThan(0);
  });
});
