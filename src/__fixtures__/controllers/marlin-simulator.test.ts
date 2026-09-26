// Controller audit MA-11: the Marlin simulator follows the Marlin 2.1.2.8
// rules the store tests depend on (marlin-sim-queue.ts cites them). Before, it
// answered comment lines, answered later lines ahead of a waiting M400, ran
// queued moves at the same time, sent `Error:` without the `ok` that follows
// it, never printed a busy keepalive, and treated G92 as a move.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from './marlin-simulator';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function openSim(options: Parameters<typeof createMarlinSimulator>[0] = {}): Promise<{
  readonly sim: MarlinSimulator;
  readonly lines: string[];
  readonly write: (data: string) => Promise<void>;
}> {
  const sim = createMarlinSimulator({ emitBannerOnOpen: false, ...options });
  const port = await sim.adapter.serial.requestPort();
  if (port === null) throw new Error('simulator port missing');
  const connection = await port.open({ baudRate: 250000 });
  const lines: string[] = [];
  connection.onLine((line) => lines.push(line));
  return { sim, lines, write: (data) => connection.write(data) };
}

describe('Marlin simulator fidelity', () => {
  it('answers nothing for a comment-only or empty line', async () => {
    const { lines, write } = await openSim();
    await write('; note\n\n   \n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual([]);
    await write('M114 ; where\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines.at(-1)).toBe('ok');
  });

  it('answers nothing after a blocking M400 until the planner drains (FIFO)', async () => {
    const { lines, write } = await openSim({ motionMs: 1_000 });
    await write('G1 X10 F600\n');
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('M400\n');
    await write('M114\n');
    await vi.advanceTimersByTimeAsync(100);
    expect(lines).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lines).toEqual(['ok', 'X:10.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0', 'ok']);
  });

  it('runs queued moves one after the other', async () => {
    const { sim, write } = await openSim({ motionMs: 1_000 });
    await write('G1 X10 F600\n');
    await write('G1 X20 F600\n');
    await vi.advanceTimersByTimeAsync(1_100);
    expect(sim.state().pendingMotions).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sim.state().pendingMotions).toBe(0);
  });

  it('delays the ok of a move until a slot frees in its 15-move planner (planner.h L765)', async () => {
    const { sim, lines, write } = await openSim({ motionMs: 1_000 });
    for (let x = 1; x <= 16; x += 1) await write(`G1 X${x} F600\n`);
    await vi.advanceTimersByTimeAsync(50);
    expect(lines.filter((line) => line === 'ok')).toHaveLength(15);
    expect(sim.state().pendingMotions).toBe(15);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lines.filter((line) => line === 'ok')).toHaveLength(16);
  });

  it('follows a handler Error: with the ok for the same line', async () => {
    const { lines, write } = await openSim({
      rejectLines: [{ pattern: /^G2\b/, error: 'G2/G3 bad parameters' }],
    });
    await write('G2 X10\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual(['Error:G2/G3 bad parameters', 'ok']);
  });

  it('prints busy keepalives every 2 s while M400 waits', async () => {
    const { lines, write } = await openSim({ motionMs: 5_000 });
    await write('G1 X10 F600\n');
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('M400\n');
    await vi.advanceTimersByTimeAsync(4_500);
    expect(lines).toEqual(['echo:busy: processing', 'echo:busy: processing']);
  });

  it('answers an M-code the build lacks with Unknown command, then ok', async () => {
    const { sim, lines, write } = await openSim({ build: { airAssist: false, laser: false } });
    await write('M8\nM5 I\nM107\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual([
      'echo:Unknown command: "M8"',
      'ok',
      'echo:Unknown command: "M5 I"',
      'ok',
      'ok',
    ]);
    expect(sim.state().laserMode).toBe('standard');
  });

  it('shifts the position on G92 without moving, and reports it', async () => {
    const { sim, lines, write } = await openSim({ motionMs: 1_000 });
    await write('G0 X10 Y5 F6000\n');
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('G92 X0 Y0\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(lines).toEqual(['X:0.00 Y:0.00 Z:0.00 E:0.00 Count X:0 Y:0 Z:0', 'ok']);
    expect(sim.state().pendingMotions).toBe(1);
    await write('G0 X2\n');
    await vi.advanceTimersByTimeAsync(10);
    expect(sim.state().pos).toEqual({ x: 2, y: 0, z: 0 });
  });

  it('drops the planner when it reads M410 and answers it after the one-second window', async () => {
    const { sim, lines, write } = await openSim({ motionMs: 10_000 });
    for (let x = 1; x <= 5; x += 1) await write(`G1 X${x * 10} F600 S100\n`);
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('M107\nM410\nM5 I\n');
    expect(sim.state().pendingMotions).toBe(0);
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual(['ok']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lines).toEqual(['ok', 'ok', 'ok']);
  });

  it('halts on M112 and answers nothing more', async () => {
    const { sim, lines, write } = await openSim();
    await write('M112\n');
    await write('M114\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual(['echo:M112 Shutdown', 'Error:Printer halted. kill() called!']);
    expect(sim.state().isHalted).toBe(true);
  });
});
