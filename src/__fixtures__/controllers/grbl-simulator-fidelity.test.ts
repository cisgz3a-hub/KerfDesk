// The GRBL simulator against GRBL 1.1h (audit ST-2). Each case states what
// stock GRBL 1.1h does, with the source line; the simulator used to be more
// forgiving in each, which hid streaming and job-lifecycle defects (ST-1: the
// simulator accepted G-code while jogging, so no store test could see the
// error:9 lock-out). `firmware: 'grblhal'` covers what grblHAL does differently.
//
// Source base: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/
// grblHAL: https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import { GRBL_PLANNER_BLOCKS } from './grbl-sim-planner';
import { createGrblSimulator, type CreateGrblSimulatorOptions } from './grbl-simulator';

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
  const sim = createGrblSimulator(options);
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });
  const lines: string[] = [];
  conn.onLine((line) => lines.push(line));
  await pump(5);
  lines.length = 0;
  return { sim, conn, lines };
}

function oks(lines: ReadonlyArray<string>): number {
  return lines.filter((line) => line === 'ok').length;
}

describe('GRBL simulator fidelity against GRBL 1.1h (audit ST-2)', () => {
  it('locks G-code out while jogging (protocol.c:99-101 -> error:9)', async () => {
    const { conn, lines } = await openSim({ motionMs: 1_000 });
    await conn.write('$J=G91 G21 Z10.000 F300\n');
    await pump(5);
    await conn.write('G0 Z5\n');
    await pump(5);
    expect(lines).toEqual(['ok', 'error:9']);
  });

  it('treats a carriage return as an end of line (protocol.c:79, :93-95)', async () => {
    // `G21\r\n` is two lines on stock GRBL: `ok` for G21 and `ok` for the empty line.
    const { conn, lines } = await openSim();
    await conn.write('G21\r\n');
    await pump(5);
    expect(lines).toEqual(['ok', 'ok']);
  });

  it('holds on M0 after draining motion and answers it only after cycle start (gcode.c:1084-1090)', async () => {
    const { conn, lines } = await openSim({ motionMs: 200 });
    await conn.write('G1 X10 F600\nM0\nG1 X20\n');
    await pump(400);
    await conn.write('?');
    await pump(5);
    expect(lines[0]).toBe('ok');
    expect(oks(lines.slice(1))).toBe(0);
    expect(lines.at(-1)).toMatch(/^<Hold:0\|/);

    // Cycle start ends the suspend: M0 answers, then the queued line is parsed.
    await conn.write('~');
    await pump(5);
    expect(oks(lines)).toBe(3);
  });

  it('answers G4 only after prior motion completes and the dwell elapses (motion_control.c:195-200)', async () => {
    const { conn, lines } = await openSim({ motionMs: 500 });
    await conn.write('G1 X10 F600\nG4 P1\nG1 X20\n');
    await pump(50);
    expect(lines).toEqual(['ok']);
    await pump(1_400);
    expect(lines).toEqual(['ok']);
    await pump(100);
    expect(oks(lines)).toBe(3);
  });

  it('parses no new line while a feed hold is complete (protocol.c:208, :546)', async () => {
    const { conn, lines } = await openSim({ motionMs: 5_000 });
    await conn.write('G1 X100 F100\n');
    await pump(5);
    await conn.write('!');
    await pump(1_000);
    lines.length = 0;
    await conn.write('G1 X110\n');
    await pump(50);
    expect(lines).toEqual([]);
    await conn.write('~');
    await pump(5);
    expect(lines).toEqual(['ok']);
  });

  it('reports a software door (0x84) as Door:0 once parked, with no door input (system.c:87-93, report.c:491-500)', async () => {
    const { conn, lines } = await openSim();
    await conn.write('\x84');
    await pump(50);
    await conn.write('?');
    await pump(5);
    expect(lines.at(-1)).toMatch(/^<Door:0\|/);
  });

  it('stays silent to status queries and lines after a hard-limit alarm until reset (protocol.c:226-236)', async () => {
    const { sim, conn, lines } = await openSim();
    sim.triggerAlarm(1);
    await pump(5);
    await conn.write('?');
    await conn.write('$X\n');
    await pump(5);
    expect(lines).toEqual(['ALARM:1', '[MSG:Reset to continue]']);

    // The reset flushes what waited in RX and comes back in Alarm.
    await conn.write('\x18');
    await pump(5);
    expect(lines.slice(2)).toEqual(["Grbl 1.1f ['$' for help]", "[MSG:'$H'|'$X' to unlock]"]);
    expect(sim.state().machine).toBe('Alarm');
    await conn.write('$X\n');
    await pump(5);
    expect(lines.slice(-2)).toEqual(['[MSG:Caution: Unlocked]', 'ok']);
  });

  it('keeps answering after a non-critical alarm, with G-code locked out', async () => {
    const { sim, conn, lines } = await openSim();
    sim.triggerAlarm(5);
    await pump(5);
    await conn.write('?');
    await conn.write('G0 X1\n');
    await pump(5);
    expect(lines[0]).toBe('ALARM:5');
    expect(lines[1]).toMatch(/^<Alarm\|/);
    expect(lines[2]).toBe('error:9');
  });

  it('models the stock planner as 15 usable blocks (planner.h:31, planner.c:250-254, 498-502)', () => {
    expect(GRBL_PLANNER_BLOCKS).toBe(15);
  });

  it('comes back in Alarm from a reset in Alarm (main.c keeps the prior state; protocol.c:49-54)', async () => {
    const { sim, conn, lines } = await openSim({ motionMs: 500 });
    await conn.write('G1 X5 F600\n');
    await pump(2);
    await conn.write('\x18');
    await pump(5);
    lines.length = 0;
    await conn.write('\x18');
    await pump(5);
    expect(lines).toEqual(["Grbl 1.1f ['$' for help]", "[MSG:'$H'|'$X' to unlock]"]);
    expect(sim.state().machine).toBe('Alarm');
  });

  it('answers no status query while homing and parses nothing until homing ends (limits.c:320)', async () => {
    const { conn, lines } = await openSim({ homingMs: 500 });
    await conn.write('$H\nG0 X1\n');
    await pump(50);
    await conn.write('?');
    await pump(50);
    expect(lines).toEqual([]);
    await pump(500);
    expect(lines).toEqual(['ok', 'ok']);
  });

  it('takes every byte above 0x7F off the stream as a realtime command (serial.c:150-196)', async () => {
    const { conn, lines } = await openSim();
    await conn.write('\x90\x99G21\n');
    await pump(5);
    expect(lines).toEqual(['ok']);
  });

  it('answers a G4 behind queued motion only once the bounded planner drains', async () => {
    const { conn, lines } = await openSim({
      plannerBlocks: GRBL_PLANNER_BLOCKS,
      blockRetireMs: 100,
    });
    await conn.write('G1 X1 F600\nG1 X2 F600\nG4 P0.01\n');
    await pump(5);
    expect(oks(lines)).toBe(2);
    await pump(250);
    expect(oks(lines)).toBe(3);
  });
});

describe('GRBL simulator grblHAL differences', () => {
  it('answers <Home|...> while homing (machine_limits.c:445-447)', async () => {
    const { conn, lines } = await openSim({ firmware: 'grblhal', homingMs: 500 });
    await conn.write('$H\n');
    await pump(50);
    await conn.write('?');
    await pump(5);
    expect(lines).toEqual([expect.stringMatching(/^<Home\|/)]);
  });

  it('repeats a G-code error for later G-code lines until a $ line or an empty line (protocol.c:245-286)', async () => {
    const { conn, lines } = await openSim({
      firmware: 'grblhal',
      rejectLines: [{ pattern: /X13\b/, errorCode: 20 }],
    });
    await conn.write('G1 X13 F500\nG4 P0.01\n$G\nG4 P0.01\n');
    await pump(50);
    expect(lines).toEqual([
      'error:20',
      'error:20',
      '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]',
      'ok',
      'ok',
    ]);
  });

  it('reads CRLF as one end of line', async () => {
    const { conn, lines } = await openSim({ firmware: 'grblhal' });
    await conn.write('G21\r\n');
    await pump(5);
    expect(lines).toEqual(['ok']);
  });

  it('keeps answering in a critical alarm and refuses $X with error:79 (system.c:1175-1183)', async () => {
    const { sim, conn, lines } = await openSim({ firmware: 'grblhal' });
    sim.triggerAlarm(1);
    await pump(5);
    await conn.write('?');
    await conn.write('$X\nG0 X1\n');
    await pump(5);
    expect(lines).toEqual([
      'ALARM:1',
      '[MSG:Reset to continue]',
      expect.stringMatching(/^<Alarm\|/),
      'error:79',
      'error:9',
    ]);
  });
});
