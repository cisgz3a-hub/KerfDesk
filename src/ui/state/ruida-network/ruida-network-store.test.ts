// The Ruida network store (ADR-697) driven end to end against the scripted
// Ruida UDP simulator: the real .rd bytes, the real session state machine and
// the real store. Simulator evidence only — no real controller is involved.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../../core/scene';
import { emitRdFile } from '../../../io/rd';
import { decodeRdStream } from '../../../__fixtures__/controllers/ruida-decoder';
import {
  RuidaUdpSimulator,
  simulatedRuidaNetwork,
  type RuidaSimScript,
} from '../../../__fixtures__/controllers/ruida-udp-simulator';
import { IDLE_READS_WITHOUT_BUSY, RUIDA_STATUS_POLL_MS } from './ruida-network-monitor';
import { RUIDA_FRAME_FIRST } from './ruida-network-messages';
import {
  resetRuidaNetworkStoreForTests,
  useRuidaNetworkStore,
  type RuidaNetworkJob,
} from './ruida-network-store';
import { testLinkJobOutcome } from '../link-job-outcome-test-helpers';

/** `lines` horizontal 10 mm lines, 1 mm apart, shifted by `offsetX`. */
function project(lines = 1, offsetX = 0): Project {
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'lines',
          source: 'lines.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: lines - 1 },
          transform: { ...IDENTITY_TRANSFORM, x: offsetX },
          paths: [
            {
              color: '#000000',
              polylines: Array.from({ length: lines }, (_, row) => ({
                closed: false,
                points: [
                  { x: 0, y: row },
                  { x: 10, y: row },
                ],
              })),
            },
          ],
        },
      ],
    },
  } as unknown as Project;
}

function job(source: Project): RuidaNetworkJob {
  const result = emitRdFile(source);
  if (!result.ok) throw new Error(result.messages.join('\n'));
  return {
    bytes: result.bytes,
    footprint: result.footprint,
    ...testLinkJobOutcome(['A warning.']),
  };
}

const store = () => useRuidaNetworkStore.getState();

async function connected(script: RuidaSimScript = {}, replyDelayMs?: number) {
  const sim = new RuidaUdpSimulator(script);
  const network = simulatedRuidaNetwork(sim, replyDelayMs === undefined ? {} : { replyDelayMs });
  const connecting = store().connect(network, '192.168.1.100');
  await vi.advanceTimersByTimeAsync(50);
  await connecting;
  return { sim, network };
}

/** Lets status reads run until the store leaves `phase`. */
async function runWhile(phase: string): Promise<void> {
  for (let polls = 0; polls < 40 && store().phase === phase; polls += 1)
    await vi.advanceTimersByTimeAsync(RUIDA_STATUS_POLL_MS);
}

async function framed(sim: RuidaUdpSimulator, frameJob: RuidaNetworkJob): Promise<void> {
  await store().frame(frameJob);
  await runWhile('framing');
  expect(store().framed).toEqual(frameJob.footprint);
  expect(sim.files).toHaveLength(1);
}

beforeEach(() => {
  vi.useFakeTimers();
  resetRuidaNetworkStoreForTests();
});
afterEach(() => {
  resetRuidaNetworkStoreForTests();
  vi.useRealTimers();
});

describe('connect', () => {
  it('connects only when a controller answers a status read', async () => {
    const { sim } = await connected();
    expect(store().phase).toBe('idle');
    expect(store().status?.jobRunning).toBe(false);
    expect(sim.reads).toEqual([0x0400]);
  });

  it('stays disconnected and says so when nothing answers', async () => {
    const sim = new RuidaUdpSimulator({ verdict: () => 'drop' });
    const connecting = store().connect(simulatedRuidaNetwork(sim), '192.168.1.100');
    await vi.advanceTimersByTimeAsync(1_000);
    await connecting;
    expect(store().phase).toBe('disconnected');
    expect(store().message).toContain('No reply from a Ruida controller at 192.168.1.100');
  });

  it('passes the bridge’s refusal through', async () => {
    const sim = new RuidaUdpSimulator();
    await store().connect(
      simulatedRuidaNetwork(sim, { openError: 'UDP port 40200 is in use' }),
      '10.0.0.2',
    );
    expect(store()).toMatchObject({ phase: 'disconnected', tone: 'error' });
    expect(store().message).toContain('40200');
  });
});

describe('frame first', () => {
  it('refuses Start without a completed Frame and sends nothing', async () => {
    const { sim } = await connected();
    await store().start(job(project()));
    expect(store().message).toBe(RUIDA_FRAME_FIRST);
    expect(sim.received).toHaveLength(1);
    expect(sim.files).toEqual([]);
  });

  it('frames with travel moves only around the job, then Start streams the exact bytes', async () => {
    const { sim } = await connected();
    const reviewed = job(project(3));
    await framed(sim, reviewed);
    const frame = sim.files[0] ?? [];
    expect(frame.filter((event) => event.kind === 'cut')).toEqual([]);
    expect(frame.filter((event) => event.kind === 'move')).toHaveLength(5);
    expect(frame.filter((event) => event.kind === 'unknown')).toEqual([]);

    await store().start(reviewed);
    expect(store().advisories).toEqual(['A warning.']);
    expect(sim.files[1]).toEqual(decodeRdStream(reviewed.bytes));
    await runWhile('running');
    expect(store()).toMatchObject({ phase: 'idle', tone: 'info' });
    expect(store().message).toContain('Job finished');
    expect(store().positionMm).toEqual({ x: 12.5, y: -2 });
  });

  it('runs the job completion (variable advance) once the job finishes', async () => {
    const { sim } = await connected();
    const completed = vi.fn();
    const reviewed = { ...job(project()), completed };
    await framed(sim, reviewed);
    expect(completed).not.toHaveBeenCalled();
    await store().start(reviewed);
    await runWhile('running');
    expect(completed).toHaveBeenCalledTimes(1);
  });

  it('needs a new Frame once the job moves', async () => {
    const { sim } = await connected();
    await framed(sim, job(project(1)));
    await store().start(job(project(1, 5)));
    expect(store().message).toBe(RUIDA_FRAME_FIRST);
    expect(sim.files).toHaveLength(1);
  });

  // Code quality audit C2 D1-P2-2: a frame that ends before any status read
  // sees it busy used to leave the store framing forever.
  it('counts a frame no read caught running only after a bounded run of idle reads', async () => {
    const { sim } = await connected({ runReads: 0 });
    const frameJob = job(project());
    await store().frame(frameJob);
    // Reads at 0, 0.4 and 0.8 s are not enough on their own.
    await vi.advanceTimersByTimeAsync(RUIDA_STATUS_POLL_MS * (IDLE_READS_WITHOUT_BUSY - 2));
    expect(store().phase).toBe('framing');
    expect(store().framed).toBeNull();
    await vi.advanceTimersByTimeAsync(RUIDA_STATUS_POLL_MS * 2);
    expect(store().phase).toBe('idle');
    expect(store().framed).toEqual(frameJob.footprint);
    expect(store().message).toContain('short frame');
    expect(sim.files).toHaveLength(1);
  });

  it('a short job no read caught running still finishes', async () => {
    const { sim } = await connected({ runReads: 0 });
    const reviewed = job(project());
    await store().frame(reviewed);
    await runWhile('framing');
    await store().start(reviewed);
    await runWhile('running');
    expect(store().phase).toBe('idle');
    expect(store().message).toContain('Job finished');
    expect(sim.files).toHaveLength(2);
  });

  it('shows the job warnings from its Frame on (C2 D1-P2-1)', async () => {
    await connected();
    await store().frame(job(project()));
    expect(store().advisories).toEqual(['A warning.']);
    await runWhile('framing');
    expect(store().advisories).toEqual(['A warning.']);
  });

  it('sends nothing to a controller that reports it is busy', async () => {
    const { sim } = await connected({ busyAtStart: true, runReads: 100 });
    await store().frame(job(project()));
    expect(store().message).toContain('busy');
    expect(store().phase).toBe('idle');
    expect(sim.files).toEqual([]);
  });
});

describe('ACK, NAK and timeout', () => {
  // Datagram 1 is the connect read, 2 the pre-frame read, 3 the frame.
  const big = () => job(project(120));

  it('resends a NAKed datagram and finishes the job', async () => {
    const { sim } = await connected({ verdict: (n) => (n === 5 ? 'nak' : 'ack') });
    const reviewed = big();
    await framed(sim, reviewed);
    const before = sim.received.length;
    await store().start(reviewed);
    const jobDatagrams = sim.received.slice(before + 1);
    expect(jobDatagrams.length).toBeGreaterThan(2);
    expect(sim.files[1]).toEqual(decodeRdStream(reviewed.bytes));
    await runWhile('running');
    expect(store().phase).toBe('idle');
  });

  it('gives up after four refusals of one datagram and sends Stop Process', async () => {
    let jobStart = Number.POSITIVE_INFINITY;
    const { sim } = await connected({
      verdict: (n) => (n >= jobStart + 1 && n <= jobStart + 4 ? 'nak' : 'ack'),
    });
    await framed(sim, big());
    jobStart = sim.received.length + 1;
    await store().start(big());
    expect(store()).toMatchObject({ phase: 'idle', tone: 'error' });
    expect(store().message).toContain('refused the same datagram four times');
    expect(store().message).toContain('acknowledged Stop Process');
    expect(sim.controls).toEqual(['stop']);
  });

  it('fails on a lost ACK without resending the datagram, and stops the controller', async () => {
    let lost = Number.POSITIVE_INFINITY;
    const { sim } = await connected({ verdict: (n) => (n === lost ? 'lose-ack' : 'ack') });
    await framed(sim, big());
    lost = sim.received.length + 3;
    const starting = store().start(big());
    await vi.advanceTimersByTimeAsync(1_000);
    await starting;
    const sentAfterLoss = sim.received.slice(lost - 1);
    // The datagram whose ACK was lost, then Stop Process: no resend in between.
    expect(sentAfterLoss).toHaveLength(2);
    expect(sim.controls).toEqual(['stop']);
    expect(store().message).toContain('nothing was resent');
    expect(store().message).toContain('after 1 acknowledged datagram');
  });

  it('treats ENQ as a keepalive, not a verdict', async () => {
    const { sim } = await connected({ verdict: (n) => (n === 3 ? 'enq' : 'ack') });
    await framed(sim, job(project()));
  });
});

describe('Pause, Resume and Abort', () => {
  it('pauses and resumes with D8 02 / D8 03, and nothing finishes while paused', async () => {
    const { sim } = await connected({ runReads: 4 });
    const reviewed = job(project());
    await framed(sim, reviewed);
    await store().start(reviewed);
    await store().pause();
    expect(store().phase).toBe('paused');
    await vi.advanceTimersByTimeAsync(RUIDA_STATUS_POLL_MS * 10);
    expect(store().phase).toBe('paused');
    await store().resume();
    expect(store().phase).toBe('running');
    await runWhile('running');
    expect(store().phase).toBe('idle');
    expect(sim.controls).toEqual(['pause', 'restore']);
  });

  it('aborts a running job with Stop Process', async () => {
    const { sim } = await connected();
    const reviewed = job(project());
    await framed(sim, reviewed);
    sim.runReads = 100;
    await store().start(reviewed);
    await store().abort();
    expect(store()).toMatchObject({ phase: 'idle', tone: 'info' });
    expect(store().message).toBe('The controller acknowledged Stop Process.');
    expect(sim.controls).toEqual(['stop']);
    expect(sim.running).toBe(false);
  });

  it('aborts mid-send: no further job datagram goes out before Stop Process', async () => {
    const { sim } = await connected({}, 5);
    const reviewed = job(project(120));
    const framing = store().frame(reviewed);
    await vi.advanceTimersByTimeAsync(200);
    await framing;
    await runWhile('framing');
    const before = sim.received.length;
    const starting = store().start(reviewed);
    while ((store().sending?.acknowledged ?? 0) < 1) await vi.advanceTimersByTimeAsync(5);
    const aborting = store().abort();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([starting, aborting]);
    expect(store().sending).toBeNull();
    // The pre-start read, the acknowledged datagram, the one in flight, then the stop.
    expect(sim.received.length - before).toBeLessThanOrEqual(4);
    expect(sim.controls).toEqual(['stop']);
    expect(sim.files).toHaveLength(1);
    expect(store().phase).toBe('idle');
  });

  it('never counts a Frame aborted while its last datagram was acknowledged', async () => {
    // 1 connect read, 2 pre-frame read, 3 the one-datagram frame, 4 the stop (lost).
    const { sim } = await connected({ verdict: (n) => (n === 4 ? 'drop' : 'ack') }, 5);
    const framing = store().frame(job(project()));
    while (store().sending === null) await vi.advanceTimersByTimeAsync(1);
    const aborting = store().abort();
    await vi.advanceTimersByTimeAsync(1_100);
    await Promise.all([framing, aborting]);
    expect(store().message).toContain('NOT acknowledged');
    // The controller never got the stop and finishes the frame on its own.
    await vi.advanceTimersByTimeAsync(RUIDA_STATUS_POLL_MS * 10);
    expect(sim.files).toHaveLength(1);
    expect(store()).toMatchObject({ phase: 'idle', framed: null });
  });

  it('says plainly when Stop Process is not acknowledged', async () => {
    let silent = false;
    const { sim } = await connected({ verdict: () => (silent ? 'drop' : 'ack') });
    await framed(sim, job(project()));
    sim.runReads = 100;
    await store().start(job(project()));
    silent = true;
    const aborting = store().abort();
    await vi.advanceTimersByTimeAsync(3_000);
    await aborting;
    expect(store().tone).toBe('error');
    expect(store().message).toContain('press Stop on the controller panel');
  });

  it('stops the job before Disconnect closes the link', async () => {
    const { sim } = await connected();
    await framed(sim, job(project()));
    sim.runReads = 100;
    await store().start(job(project()));
    await store().disconnect();
    expect(sim.controls).toEqual(['stop']);
    expect(store().phase).toBe('disconnected');
  });

  it('tells the operator a job may still run when the link drops mid-job', async () => {
    const { sim, network } = await connected();
    await framed(sim, job(project()));
    sim.runReads = 100;
    await store().start(job(project()));
    network.dropLink('The UDP socket closed.');
    expect(store()).toMatchObject({ phase: 'disconnected', tone: 'error', framed: null });
    expect(store().message).toContain('keeps running');
  });
});
