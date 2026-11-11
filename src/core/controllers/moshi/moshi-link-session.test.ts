// The Moshi run loop (ADR-705) against the scripted board: MeerK40t's order
// (status OK, prologue, 32-byte data packets, status, epilogue, poll to OK),
// Frame without a cut, refusals on an error or dead status, and Abort.
import { describe, expect, it } from 'vitest';
import { MoshiSimulator } from '../../../__fixtures__/controllers/moshi-simulator';
import { encodeMoshiFrameProgram } from './moshi-frame';
import { runMoshiPrograms, type MoshiRunOptions } from './moshi-link-session';
import { writeHomeProgram, writeVectorProgram } from './moshi-programs';

const LINE = writeVectorProgram(
  [
    { x: 100, y: 100, cut: false },
    { x: 900, y: 100, cut: true },
    { x: 900, y: 500, cut: true },
    { x: 100, y: 500, cut: true },
  ],
  20,
);

function options(overrides: Partial<MoshiRunOptions> = {}): MoshiRunOptions {
  return { cancelled: () => false, wait: async () => undefined, ...overrides };
}

describe('runMoshiPrograms', () => {
  it('sends each program in MeerK40t order and waits for the board to finish', async () => {
    const board = new MoshiSimulator({ busyReads: 2 });
    const result = await runMoshiPrograms(board, [LINE, writeHomeProgram()], options());
    expect(result).toEqual({ ok: true });
    const kinds = board.events.map((event) =>
      event.kind === 'status' ? `status ${event.code}` : event.kind,
    );
    // The line program is 37 bytes: a 32-byte and a 5-byte data packet.
    expect(kinds.slice(0, 8)).toEqual([
      'status 205',
      'prologue',
      'data',
      'data',
      'status 205',
      'epilogue',
      'status 207',
      'status 207',
    ]);
    expect(board.runs.map((run) => run.completed)).toEqual([true, true]);
    expect(board.cuts()).toEqual([
      { x: 900, y: 100 },
      { x: 900, y: 500 },
      { x: 100, y: 500 },
    ]);
    expect(board.decodeErrors).toEqual([]);
  });

  it('runs a Frame with the laser off around the footprint', async () => {
    const board = new MoshiSimulator();
    const frame = encodeMoshiFrameProgram({ minX: 100, minY: 200, maxX: 300, maxY: 400 }, 6000);
    expect(await runMoshiPrograms(board, [frame], options())).toEqual({ ok: true });
    const run = board.runs[0];
    expect(run?.program.speed).toBe(100);
    expect(run?.program.steps.every((step) => !step.cut)).toBe(true);
    expect(run?.program.steps.map(({ x, y }) => [x, y])).toEqual([
      [100, 200],
      [300, 200],
      [300, 400],
      [100, 400],
      [100, 200],
    ]);
  });

  it('sends nothing to a board that reports an error or no status', async () => {
    for (const board of [
      new MoshiSimulator({ errorBeforeProgram: true }),
      new MoshiSimulator({ fixedStatus: 0 }),
    ]) {
      const result = await runMoshiPrograms(board, [LINE], options());
      expect(result.ok).toBe(false);
      expect(board.events.some((event) => event.kind === 'prologue')).toBe(false);
    }
  });

  it('stops sending packets once cancelled', async () => {
    let cancelled = false;
    const board = new MoshiSimulator({
      onData: () => {
        cancelled = true;
      },
    });
    const result = await runMoshiPrograms(board, [LINE], options({ cancelled: () => cancelled }));
    expect(result).toEqual({ ok: false, failure: { kind: 'cancelled' }, programsSent: 0 });
    expect(board.events.filter((event) => event.kind === 'data')).toHaveLength(1);
    expect(board.events.some((event) => event.kind === 'epilogue')).toBe(false);
  });

  it('reports a link that fails mid-run', async () => {
    const board = new MoshiSimulator();
    const failing = {
      ...board,
      readStatus: board.readStatus,
      writeAddress: board.writeAddress,
      writeData: async () => {
        throw new Error('transfer stalled');
      },
    };
    const result = await runMoshiPrograms(failing, [LINE], options());
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'link-failed', reason: 'transfer stalled' },
      programsSent: 0,
    });
  });
});
