// Independent coordinates for valid stock GRBL modal groups. The firmware
// parses every G word before executing the block, regardless of word order:
// gnea/grbl bfb67f0c gcode.c:128-224, distance/coordinate conversion:540-601.
// This model only supports G54 and mm; it is not a complete parser validator.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator } from './grbl-simulator';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('GRBL simulation of independently calculated compound modal moves', () => {
  it.each(['grbl', 'grblhal'] as const)(
    'moves an atomic mm/G54/absolute block on %s and drains before its ACK fence',
    async (firmware) => {
      const sim = createGrblSimulator({
        firmware,
        motionMs: 50,
        storedOffsets: { g54: { x: 5, y: 7, z: 2 } },
      });
      const port = await sim.adapter.serial.requestPort();
      if (port === null) throw new Error('Missing fake serial port.');
      const conn = await port.open({ baudRate: 115200 });
      const replies: string[] = [];
      conn.onLine((line) => replies.push(line));
      await vi.advanceTimersByTimeAsync(5);
      replies.length = 0;
      await conn.write('G21 G90 G54 G94 G1 X10 Y20 Z3 F600 S0\nG4 P0.01\n');
      expect(sim.state().mpos).toEqual({ x: 15, y: 27, z: 5 });
      expect(sim.state().machine).toBe('Run');
      expect(sim.state().pendingLine?.phase).toBe('sync');
      await vi.advanceTimersByTimeAsync(40);
      expect(replies).toEqual(['ok']);
      await vi.advanceTimersByTimeAsync(30);
      expect(replies).toEqual(['ok', 'ok']);
      expect(sim.state().machine).toBe('Idle');
      await conn.close();
    },
  );

  it.each([
    'G21 G91 G54 G94 G1 X-2 Y3 Z1 F600 S0',
    'G94 G54 G21 G1 G91 X-2 Y3 Z1 F600 S0',
    'G91 G0 G21 G54 X-2 Y3 Z1',
  ])('resolves relative axes without adding WCO again: %s', async (command) => {
    const sim = createGrblSimulator({ storedOffsets: { g54: { x: 5, y: 7, z: 2 } } });
    const port = await sim.adapter.serial.requestPort();
    if (port === null) throw new Error('Missing fake serial port.');
    const conn = await port.open({ baudRate: 115200 });
    await vi.advanceTimersByTimeAsync(5);
    await conn.write('G0 X10 Y20 Z3\n');
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.state().mpos).toEqual({ x: 15, y: 27, z: 5 });
    await conn.write(`${command}\n`);
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.state().mpos).toEqual({ x: 13, y: 30, z: 6 });
    expect(sim.state().isAbsolute).toBe(false);
    await conn.close();
  });

  it('keeps a compound G54/G92 origin assignment out of the motion planner', async () => {
    const sim = createGrblSimulator({ storedOffsets: { g54: { x: 5, y: 7, z: 2 } } });
    const port = await sim.adapter.serial.requestPort();
    if (port === null) throw new Error('Missing fake serial port.');
    const conn = await port.open({ baudRate: 115200 });
    await vi.advanceTimersByTimeAsync(5);
    await conn.write('G0 X10 Y20 Z3\n');
    await vi.advanceTimersByTimeAsync(20);
    await conn.write('G54 G92 X0 Y0 Z0\n');
    expect(sim.state().mpos).toEqual({ x: 15, y: 27, z: 5 });
    expect(sim.state().g92).toEqual({ x: 10, y: 20, z: 3 });
    expect(sim.state().pendingMotions).toBe(0);
    expect(sim.state().machine).toBe('Idle');
    await conn.close();
  });

  it('uses machine axes for a valid absolute G53 block with a later G0', async () => {
    const sim = createGrblSimulator({ storedOffsets: { g54: { x: 5, y: 7, z: 2 } } });
    const port = await sim.adapter.serial.requestPort();
    if (port === null) throw new Error('Missing fake serial port.');
    const conn = await port.open({ baudRate: 115200 });
    await vi.advanceTimersByTimeAsync(5);
    await conn.write('G0 X10 Y20 Z3\n');
    await vi.advanceTimersByTimeAsync(20);
    await conn.write('G21 G90 G53 G0 X8 Y9 Z10\n');
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.state().mpos).toEqual({ x: 8, y: 9, z: 10 });
    expect(sim.state().g54).toEqual({ x: 5, y: 7, z: 2 });
    await conn.write('G21 G90 G54 G0 X8 Y9 Z10\n');
    await vi.advanceTimersByTimeAsync(20);
    expect(sim.state().mpos).toEqual({ x: 13, y: 16, z: 12 });
    await conn.close();
  });
});
