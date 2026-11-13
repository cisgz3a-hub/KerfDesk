// The GRBL simulator's motion time, arcs and write failures (code quality audit
// C2, D3-P3-7). Tested here first, so the Abort tests that rely on them can
// trust them (ADR-025 discipline).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
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

async function openSim(options: CreateGrblSimulatorOptions = {}) {
  const sim = createGrblSimulator(options);
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn: SerialConnection = await portRef.open({ baudRate: 115200 });
  const lines: string[] = [];
  conn.onLine((line) => lines.push(line));
  await pump(5);
  lines.length = 0;
  return { sim, conn, lines };
}

/** Ask for one status report and return its machine position and state. */
async function report(conn: SerialConnection, lines: string[]) {
  lines.length = 0;
  await conn.write('?');
  await pump(2);
  const status = lines.find((line) => line.startsWith('<'));
  const match = /^<([A-Za-z]+)[^|]*\|MPos:(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/.exec(status ?? '');
  if (match === null) throw new Error(`No status report in ${JSON.stringify(lines)}`);
  return { state: match[1], x: Number(match[2]), y: Number(match[3]), z: Number(match[4]) };
}

describe('kinematic motion time', () => {
  it('takes a move its length over its feed and reports the head along it', async () => {
    const { conn, lines } = await openSim({ kinematic: true });
    await conn.write('G1 X100 F600\n'); // 100 mm at 10 mm/s: 10 s
    await pump(4_000);
    const along = await report(conn, lines);
    expect(along.state).toBe('Run');
    expect(along.x).toBeGreaterThan(35);
    expect(along.x).toBeLessThan(45);

    await pump(6_100);
    expect(await report(conn, lines)).toMatchObject({ state: 'Idle', x: 100 });
  });

  it('runs queued moves one after another', async () => {
    const { conn, lines } = await openSim({ kinematic: true });
    await conn.write('G1 X10 F600\nG1 X10 Y10\n'); // 1 s each
    await pump(1_500);
    const second = await report(conn, lines);
    expect(second.x).toBe(10);
    expect(second.y).toBeGreaterThan(4);
    expect(second.y).toBeLessThan(6);
  });

  it('stops the head where it is at a soft reset', async () => {
    const { sim, conn } = await openSim({ kinematic: true });
    await conn.write('G1 X100 F600\n');
    await pump(2_000);
    await conn.write('\x18');
    await pump(10);
    expect(sim.state().mpos.x).toBeGreaterThan(15);
    expect(sim.state().mpos.x).toBeLessThan(25);
  });

  it('keeps the fixed-time model when it is not asked for', async () => {
    const { conn, lines } = await openSim();
    await conn.write('G1 X100 F600\n');
    await pump(2);
    expect((await report(conn, lines)).x).toBe(100);
  });
});

describe('arcs', () => {
  it('ends a G2 or G3 at its end point', async () => {
    const { sim, conn } = await openSim();
    await conn.write('G2 X20 Y0 I10 J0 F600\nG3 X20 Y20 I0 J10\n');
    await pump(50);
    expect(sim.state().mpos).toEqual({ x: 20, y: 20, z: 0 });
  });

  it('reports a point on the arc while it runs, under the kinematic clock', async () => {
    const { conn, lines } = await openSim({ kinematic: true });
    // A half circle of radius 10 about (10, 0), clockwise over the top: 31.4 mm at 10 mm/s.
    await conn.write('G2 X20 Y0 I10 J0 F600\n');
    await pump(1_570); // half way: the top of the arc
    const top = await report(conn, lines);
    expect(Math.hypot(top.x - 10, top.y)).toBeCloseTo(10, 1);
    expect(top.x).toBeCloseTo(10, 0);
    expect(top.y).toBeCloseTo(10, 0);
  });
});

describe('write failures', () => {
  it('rejects a matching write on an open port and passes nothing to the firmware', async () => {
    const { sim, conn } = await openSim();
    sim.port.failWrites((data) => data.startsWith('G1'));
    await expect(conn.write('G1 X5 F600\n')).rejects.toThrow('Fake serial write failed.');
    expect(sim.port.isClosed()).toBe(false);
    expect(sim.outbound()).not.toContain('G1 X5 F600\n');
    await conn.write('G0 X1\n');
    expect(sim.outbound()).toContain('G0 X1\n');
  });

  it('can close the port as the write fails, as a cable pull does', async () => {
    const { sim, conn } = await openSim();
    let closes = 0;
    conn.onClose(() => {
      closes += 1;
    });
    sim.port.failWrites(() => true, { closePort: true });
    await expect(conn.write('G1 X5\n')).rejects.toThrow();
    expect(sim.port.isClosed()).toBe(true);
    expect(closes).toBe(1);
  });
});
