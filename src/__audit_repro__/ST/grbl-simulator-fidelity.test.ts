// ST-2 repro — the shared GRBL simulator (src/__fixtures__/controllers/
// grbl-sim-machine.ts + grbl-simulator.ts) is more forgiving than GRBL 1.1h in
// ways that hide streaming and job-lifecycle defects. Every case below states
// what stock GRBL 1.1h (gnea/grbl bfb67f0c, 20190830) does, with the source
// line, and FAILS against the current simulator. ST-1 (Continue during an
// operator jog) is the concrete defect case 1 hides: the simulator accepts
// G-code while jogging, so no store test could see the error:9 lock-out.
//
// Source base: https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import {
  createGrblSimulator,
  type CreateGrblSimulatorOptions,
} from '../../__fixtures__/controllers/grbl-simulator';
import { GRBL_PLANNER_BLOCKS } from '../../__fixtures__/controllers/grbl-sim-planner';

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

describe('ST-2: GRBL simulator fidelity against GRBL 1.1h', () => {
  it('locks G-code out while jogging (protocol.c:99-101 -> error:9)', async () => {
    // protocol.c:99  } else if (sys.state & (STATE_ALARM | STATE_JOG)) {
    // protocol.c:101   report_status_message(STATUS_SYSTEM_GC_LOCK);
    const { conn, lines } = await openSim({ motionMs: 1_000 });
    await conn.write('$J=G91 G21 Z10.000 F300\n');
    await pump(5);
    await conn.write('G0 Z5\n');
    await pump(5);
    expect(lines).toEqual(['ok', 'error:9']);
  });

  it('treats a carriage return as an end of line (protocol.c:79, :93-95)', async () => {
    // protocol.c:79  if ((c == '\n') || (c == '\r')) { // End of line reached
    // protocol.c:93  } else if (line[0] == 0) { // Empty or comment line. For syncing purposes.
    //                  report_status_message(STATUS_OK);
    // So `G21\r\n` is two lines on stock GRBL: `ok` for G21 and `ok` for the empty line.
    const { conn, lines } = await openSim();
    await conn.write('G21\r\n');
    await pump(5);
    expect(lines).toEqual(['ok', 'ok']);
  });

  it('holds on M0 after draining motion and answers it only after cycle start (gcode.c:1084-1090)', async () => {
    // gcode.c:1085 protocol_buffer_synchronize(); ... :1088 system_set_exec_state_flag(EXEC_FEED_HOLD);
    // The suspend loop (protocol.c:546) does not return to the parser until `~`,
    // so M0's `ok` and every later line wait for cycle start; status reports Hold:0.
    const { conn, lines } = await openSim({ motionMs: 200 });
    await conn.write('G1 X10 F600\nM0\nG1 X20\n');
    await pump(400);
    await conn.write('?');
    await pump(5);
    expect(lines[0]).toBe('ok');
    expect(lines.slice(1).filter((line) => line === 'ok')).toEqual([]);
    expect(lines.at(-1)).toMatch(/^<Hold:0\|/);
  });

  it('answers G4 only after prior motion completes and the dwell elapses (motion_control.c:195-200)', async () => {
    // mc_dwell(): protocol_buffer_synchronize(); delay_sec(seconds, DELAY_MODE_DWELL);
    const { conn, lines } = await openSim({ motionMs: 500 });
    await conn.write('G1 X10 F600\nG4 P1\n');
    await pump(50);
    expect(lines).toEqual(['ok']);
  });

  it('parses no new line while a feed hold is complete (protocol.c:208, :546)', async () => {
    // protocol_execute_realtime() enters protocol_exec_rt_suspend() whenever
    // sys.suspend is set, and loops `while (sys.suspend)` until cycle start;
    // the main loop calls it at every end of line (protocol.c:81) before parsing.
    // Pump well past the deceleration (F100 at a default $120=10 mm/s^2 stops
    // in ~0.17 s): while still Hold:1 GRBL may parse one more line if the
    // planner has room, but once Hold:0 is reached the parser is suspended.
    const { conn, lines } = await openSim({ motionMs: 5_000 });
    await conn.write('G1 X100 F100\n');
    await pump(5);
    await conn.write('!');
    await pump(1_000);
    lines.length = 0;
    await conn.write('G1 X110\n');
    await pump(50);
    expect(lines).toEqual([]);
  });

  it('reports a software door (0x84) as Door:0 once parked, with no door input (system.c:87-93, report.c:491-500)', async () => {
    // system_check_safety_door_ajar() returns false without ENABLE_SAFETY_DOOR_INPUT_PIN
    // (config.h:175 default disabled), so the suspend loop clears SUSPEND_SAFETY_DOOR_AJAR
    // (protocol.c:642-645) and report.c prints Door:0 ("closed and ready to resume").
    // Door:1 means the door input is open and cycle start is ignored (protocol.c:336).
    const { conn, lines } = await openSim();
    await conn.write('\x84');
    await pump(50);
    await conn.write('?');
    await pump(5);
    expect(lines.at(-1)).toMatch(/^<Door:0\|/);
  });

  it('stays silent to status queries after a hard-limit alarm until reset (protocol.c:226-236)', async () => {
    // Hard/soft limit: report ALARM, print [MSG:Reset to continue], then
    //   do { } while (bit_isfalse(sys_rt_exec_state,EXEC_RESET));
    // with an empty body: no status report is served until a soft reset.
    const { sim, conn, lines } = await openSim();
    sim.triggerAlarm(1);
    await pump(5);
    await conn.write('?');
    await pump(5);
    expect(lines).toEqual(['ALARM:1', '[MSG:Reset to continue]']);
  });

  it('models the stock planner as 15 usable blocks (planner.h:31, planner.c:250-254, 498-502)', () => {
    // BLOCK_BUFFER_SIZE 16 with one slot always empty: plan_check_full_buffer()
    // is true when tail == next_head, and an idle report prints Bf:15,128.
    expect(GRBL_PLANNER_BLOCKS).toBe(15);
  });
});
