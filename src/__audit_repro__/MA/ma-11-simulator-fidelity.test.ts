// Audit track MA (Marlin), finding MA-11: the repo's Marlin simulator
// (src/__fixtures__/controllers/marlin-simulator.ts) is more forgiving than
// Marlin 2.1.2.8 in ways that hide real KerfDesk behaviour: MA-4, MA-5, MA-7
// and MA-9 only show up on marlin-fifo-model.ts.
//
// Each case states the upstream rule the simulator breaks:
// 1. Comment-only / empty lines get no reply: queue.cpp process_stream_char()
//    drops ';' comments (L369-L372), process_line_done() reports the empty
//    buffer (L396-L405) and get_serial_commands() `continue`s (L466-L468).
//    The simulator answers `ok` (hides MA-5).
// 2. Commands run strictly in order: M400 / M5 block in planner.synchronize()
//    (M400.cpp L29-L33; M3-M5.cpp L142-L145) and nothing after them is
//    processed or answered until they return. The simulator answers a later
//    M114 at once.
// 3. Planned moves execute one after another (one current block in the
//    stepper ISR); two 1 s moves take 2 s. The simulator ends every move
//    motionMs after it was queued, and never delays an `ok` for a full
//    16-block planner (planner.h L774-L777 get_next_free_block).
// 4. A handler error is followed by `ok` for the same line: SERIAL_ERROR_MSG
//    in the handler, then process_parsed_command() calls queue.ok_to_send()
//    (gcode.cpp L1122; e.g. G2_G3.cpp L487 "G2/G3 bad parameters"). The
//    simulator's rejectLines send the Error: line only.
// 5. While a handler waits, idle() prints `echo:busy: processing` every
//    DEFAULT_KEEPALIVE_INTERVAL (2 s; gcode.cpp L1204-L1229, MarlinCore.cpp
//    L836, Configuration.h L2228-L2229). The simulator's header promises
//    "`echo:busy:` while long operations run" but it never sends one (hides
//    MA-4 and MA-9).
// Not tested here, documented in tracks/MA.md: the boot banner is more than
// `start` (MarlinCore.cpp L1185, L1278-L1293); G92 is modelled as a move and
// G92/G28 print no position line (G92.cpp L131, G28.cpp L619); an M112 halt
// clears when the port reopens, which only a board that resets on port open
// does (MarlinCore.cpp L956 "Wait for RESET button or power-cycle").
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/queue.cpp#L396-L405
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1114-L1122
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/gcode.cpp#L1204-L1229
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
  const port = await sim.adapter.serial.requestPort();
  if (port === null) throw new Error('simulator port missing');
  const connection = await port.open({ baudRate: 250000 });
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

  it('prints busy keepalives while M400 waits', async () => {
    const { lines, write } = await openSim({ motionMs: 5_000 });
    await write('G1 X10 F600\n');
    await vi.advanceTimersByTimeAsync(10);
    lines.splice(0);
    await write('M400\n');
    await vi.advanceTimersByTimeAsync(4_500);
    // Marlin: `echo:busy: processing` at about 2 s and 4 s, and no ok yet.
    expect(lines.filter((line) => line === 'echo:busy: processing').length).toBeGreaterThanOrEqual(
      2,
    );
  });
});
