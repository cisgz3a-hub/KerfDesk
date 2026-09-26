import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStreamer,
  pause,
  resume,
  step,
  type StreamerState,
} from '../../core/controllers/grbl';
import { decodeProgramLines, encodeProgramLines } from './serial-program-buffer';
import type * as ProgramBuffer from './serial-program-buffer';
import type { SerialWorkerRequest } from './serial-worker-protocol';
import { createWorkerRefillHandover } from './worker-refill-handover';

// The real encoder behind a spy, so one test can make encoding slow.
vi.mock('./serial-program-buffer', async (importOriginal) => {
  const actual = await importOriginal<typeof ProgramBuffer>();
  return { ...actual, encodeProgramLines: vi.fn(actual.encodeProgramLines) };
});

// Audit SER-1: every Start, Resume and tool-change Continue posted an arm
// carrying the whole streamer, whose queued array is the whole program, and the
// copy ran under the handshake deadline; a missed deadline closes the port. The
// program now crosses once per run as transferred buffers, and an arm carries
// only the position (ADR-354 Amendment 3).
const TIMEOUT_MS = 100;
const LARGE_JOB_LINES = 200_000;

type Sent = { readonly message: SerialWorkerRequest; readonly transfer: ReadonlyArray<unknown> };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** `lines` distinct moves with the first one already on the wire. */
function job(lines: number): StreamerState {
  const gcode = Array.from({ length: lines }, (_, i) => `G1 X${i + 1}.000`).join('\n');
  return step(createStreamer(gcode, { rxBufferBytes: 11 })).state;
}

// postMessage copies whatever it is not told to transfer, and that copy takes
// time in proportion to its size. JSON prints an ArrayBuffer as {}, so its
// length counts what a structured clone would copy, not what it would move.
function copiedKilobytes(message: SerialWorkerRequest): number {
  return JSON.stringify(message).length / 1024;
}

function harness(copyMsPerKilobyte = 0) {
  vi.useFakeTimers();
  const sent: Sent[] = [];
  const fail = vi.fn();
  const handover = createWorkerRefillHandover({
    post: (message, transfer = []) => {
      vi.advanceTimersByTime(copiedKilobytes(message) * copyMsPerKilobyte);
      sent.push({ message, transfer });
    },
    timeoutMs: TIMEOUT_MS,
    fail,
    onWriteError: () => () => undefined,
  });
  const last = <K extends SerialWorkerRequest['kind']>(kind: K) =>
    sent
      .map((entry) => entry.message)
      .filter(
        (message): message is Extract<SerialWorkerRequest, { kind: K }> => message.kind === kind,
      )
      .at(-1);
  // The worker establishes its barrier; the snapshot is taken and posted.
  const armToReady = (snapshot: StreamerState): Promise<void> => {
    const arming = handover.refill.arm(() => snapshot);
    const prepare = last('prepare-arm');
    if (prepare === undefined) throw new Error('Expected a prepare-arm barrier.');
    expect(handover.receive({ kind: 'ready', id: prepare.id })).toBe(true);
    return arming;
  };
  const adopt = async (snapshot: StreamerState): Promise<void> => {
    const arming = armToReady(snapshot);
    const arm = last('arm');
    if (arm === undefined) throw new Error('Expected an arm.');
    handover.receive({ kind: 'armed', id: arm.id });
    await arming;
  };
  const releaseToMain = async (retiredProgram?: number): Promise<void> => {
    const releasing = handover.refill.release();
    const request = last('release');
    if (request === undefined) throw new Error('Expected a release.');
    handover.receive({
      kind: 'released',
      id: request.id,
      ...(retiredProgram === undefined ? {} : { retiredProgram }),
    });
    await releasing;
  };
  const kinds = () => sent.map((entry) => entry.message.kind);
  return { handover, sent, fail, last, kinds, armToReady, adopt, releaseToMain };
}

describe('worker refill handover: the program crosses once per run', () => {
  it('posts the program once as transferred buffers and an arm that carries only the position', () => {
    const h = harness();
    const snapshot = job(3);
    void h.armToReady(snapshot);

    expect(h.kinds()).toEqual(['prepare-arm', 'program', 'arm']);
    const program = h.last('program');
    const arm = h.last('arm');
    if (program === undefined || arm === undefined) throw new Error('Expected program and arm.');
    expect(h.sent[1]?.transfer).toHaveLength(2);
    expect(h.sent[1]?.transfer[0]).toBe(program.bytes);
    expect(h.sent[1]?.transfer[1]).toBe(program.offsets);
    expect([...(decodeProgramLines(program) ?? [])]).toEqual(snapshot.queued);
    expect(arm.programId).toBe(program.programId);
    expect(arm).not.toHaveProperty('streamer');
    const { queued: _queued, ...position } = snapshot;
    expect(arm.position).toEqual(position);
  });

  it('sends an arm whose size does not grow with the job', () => {
    const small = harness();
    void small.armToReady(job(3));
    const large = harness();
    void large.armToReady(job(LARGE_JOB_LINES));

    const smallArm = small.last('arm');
    const largeArm = large.last('arm');
    if (smallArm === undefined || largeArm === undefined) throw new Error('Expected arms.');
    // Only the digits of `total` differ between the two positions.
    expect(copiedKilobytes(largeArm)).toBeLessThan(copiedKilobytes(smallArm) + 0.05);
  });

  it('cannot miss its deadline however slowly a large program is copied', async () => {
    // One millisecond per kilobyte is about a thousand times slower than Node
    // copies this shape; the old arm took seconds at this rate.
    const h = harness(1);
    const arming = h.armToReady(job(LARGE_JOB_LINES));
    expect(h.fail).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 10);
    const arm = h.last('arm');
    if (arm === undefined) throw new Error('Expected an arm.');
    h.handover.receive({ kind: 'armed', id: arm.id });
    await arming;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fail).not.toHaveBeenCalled();
    expect(h.handover.refill.isArmed()).toBe(true);
  });

  it('does not count the time spent encoding the program against the worker', async () => {
    const encode = vi.mocked(encodeProgramLines);
    const actual = encode.getMockImplementation();
    if (actual === undefined) throw new Error('Expected the real encoder behind the spy.');
    const h = harness();
    encode.mockImplementationOnce((lines) => {
      vi.advanceTimersByTime(TIMEOUT_MS * 10);
      return actual(lines);
    });
    const arming = h.armToReady(job(3));
    expect(h.fail).not.toHaveBeenCalled();

    // The deadline restarted once the program was posted: the arm has it all.
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(h.fail).not.toHaveBeenCalled();
    const arm = h.last('arm');
    if (arm === undefined) throw new Error('Expected an arm.');
    h.handover.receive({ kind: 'armed', id: arm.id });
    await arming;
    expect(h.fail).not.toHaveBeenCalled();
  });

  it('still fails a silent worker at the plain deadline, whatever the program size', async () => {
    const h = harness();
    void h.armToReady(job(LARGE_JOB_LINES));

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(h.fail).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(h.fail).toHaveBeenCalledOnce();
  });

  it('re-arms a Resume from the program the worker holds, without sending it again', async () => {
    const h = harness();
    const start = job(1_000);
    await h.adopt(start);
    const startProgram = h.last('program');
    await h.releaseToMain();
    h.sent.length = 0;

    // Pause and Resume keep the run's queue: the same program, a new position.
    const resumed = resume(pause({ ...start, completed: 1, inFlight: [] }));
    await h.adopt(resumed);

    expect(h.kinds()).toEqual(['prepare-arm', 'arm']);
    // Nothing the Resume posted copies the program's lines.
    for (const { message } of h.sent) expect(copiedKilobytes(message)).toBeLessThan(1);
    expect(startProgram).toBeDefined();
    expect(h.last('arm')?.programId).toBe(startProgram?.programId);
    expect(h.last('arm')?.position).toMatchObject({ completed: 1, inFlight: [] });
    expect(h.handover.refill.isArmed()).toBe(true);
  });

  it('sends a new run its own program, even when the lines are the same', async () => {
    const h = harness();
    await h.adopt(job(3));
    await h.releaseToMain();
    const firstProgram = h.last('program');
    h.sent.length = 0;

    await h.adopt(job(3));

    expect(h.kinds()).toEqual(['prepare-arm', 'program', 'arm']);
    expect(h.last('program')?.programId).not.toBe(firstProgram?.programId);
    expect(h.last('arm')?.programId).toBe(h.last('program')?.programId);
  });

  it('sends the program again after the worker retires it with an ended stream', async () => {
    const h = harness();
    const run = job(3);
    await h.adopt(run);
    const program = h.last('program');
    await h.releaseToMain(program?.programId);
    h.sent.length = 0;

    await h.adopt(run);

    expect(h.kinds()).toEqual(['prepare-arm', 'program', 'arm']);
  });

  it('sends the program again after a stopped refill, which retires it on both sides', async () => {
    const h = harness();
    const run = job(3);
    await h.adopt(run);
    h.handover.receive({ kind: 'refill-stopped' });
    expect(h.handover.refill.isArmed()).toBe(false);
    h.sent.length = 0;

    await h.adopt(run);

    expect(h.kinds()).toEqual(['prepare-arm', 'program', 'arm']);
  });
});

describe('worker refill handover: an arm the worker cannot honour', () => {
  it('returns the refill to this thread when the worker refuses the arm', async () => {
    const h = harness();
    const arming = h.armToReady(job(3));
    expect(h.handover.refill.isArmed()).toBe(true);

    // A worker that does not hold the named program answers with a stop.
    h.handover.receive({ kind: 'refill-stopped' });
    await arming;

    expect(h.handover.refill.isArmed()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.fail).not.toHaveBeenCalled();
  });

  it('keeps the refill on this thread when the program cannot be encoded', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness();
    const broken = { ...job(3), queued: ['G1 X1.000\n', 7] } as unknown as StreamerState;
    const arming = h.armToReady(broken);

    expect(h.kinds()).toEqual(['prepare-arm', 'release']);
    expect(h.handover.refill.isArmed()).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    const release = h.last('release');
    if (release === undefined) throw new Error('Expected a release.');
    h.handover.receive({ kind: 'released', id: release.id });
    await arming;
    expect(h.fail).not.toHaveBeenCalled();
  });
});
