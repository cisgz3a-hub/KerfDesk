// Audit track MA (Marlin), finding MA-11: the repo's Marlin simulator is more
// forgiving than Marlin 2.1.2.8 in ways that hide real KerfDesk behaviour
// (MA-4, MA-5, MA-7, MA-9 needed marlin-fifo-model.ts to show up).
//
// Each case states the upstream rule the simulator breaks:
// 1. Comment-only / empty lines get no reply: queue.cpp process_stream_char()
//    drops ';' comments, process_line_done() reports the empty buffer and
//    get_serial_commands() `continue`s (L369-L405, L464-L468).
// 2. Commands run strictly in order: M400 / M5 block in planner.synchronize()
//    and nothing after them is processed or answered until they return
//    (M400.cpp; M3-M5.cpp L142-L154; queue.cpp advance()).
// 3. Planned moves execute one after another (stepper.cpp block_phase_isr);
//    two 1 s moves take 2 s, not 1 s.
// 4. A handler error is followed by `ok` for the same line: SERIAL_ERROR_MSG
//    in the handler, then process_parsed_command() calls queue.ok_to_send()
//    (gcode.cpp L1122; e.g. G2_G3.cpp L487 "G2/G3 bad parameters").
// 5. The boot banner is `start` then `Marlin <version>` and `echo:` lines
//    (MarlinCore.cpp L1185, L1285-L1293).
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L396-L405
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/MarlinCore.cpp#L1185
//
// Correct behaviour: the simulator follows these rules (or the tests that rely
// on it say which firmware behaviour they deliberately do not model).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';

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
  const connection = await (await sim.adapter.serial.requestPort()).open({ baudRate: 250000 });
  const lines: string[] = [];
  connection.onLine((line) => lines.push(line));
  return { sim, lines, write: (data) => connection.write(data) };
}

describe('MA-11: Marlin simulator fidelity gaps', () => {
  it('does not answer a comment-only line', async () => {
    const { lines, write } = await openSim();
    await write('; note\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual([]);
  });

  it('answers nothing after a blocking M400 until the planner drains (FIFO)', async () => {
    const { lines, write } = await openSim({ motionMs: 1_000 });
    await write('G1 X10 F600\n');
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('M400\n');
    await write('M114\n');
    await vi.advanceTimersByTimeAsync(100);
    // Marlin: M114 is still queued behind M400, so no reply yet.
    expect(lines).toEqual([]);
  });

  it('runs two queued moves one after the other', async () => {
    const { sim, write } = await openSim({ motionMs: 1_000 });
    await write('G1 X10 F600\n');
    await write('G1 X20 F600\n');
    await vi.advanceTimersByTimeAsync(1_100);
    // Marlin: the second move has only just started.
    expect(sim.state().pendingMotions).toBe(1);
  });

  it('follows a handler Error: with ok for the same line', async () => {
    const { lines, write } = await openSim({
      rejectLines: [{ pattern: /^G2\b/, error: 'G2/G3 bad parameters' }],
    });
    await write('G2 X10\n');
    await vi.advanceTimersByTimeAsync(50);
    expect(lines).toEqual(['Error:G2/G3 bad parameters', 'ok']);
  });
});
