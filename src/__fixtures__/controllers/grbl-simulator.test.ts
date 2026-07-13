// Tests the measuring instrument first (ADR-025 discipline): the GRBL
// simulator must behave like GRBL v1.1 before any integration test or new
// controller work is allowed to trust it.

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

type OpenSim = {
  readonly sim: ReturnType<typeof createGrblSimulator>;
  readonly conn: SerialConnection;
  readonly lines: string[];
};

async function openSim(options: CreateGrblSimulatorOptions = {}): Promise<OpenSim> {
  const sim = createGrblSimulator(options);
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });
  const lines: string[] = [];
  conn.onLine((l) => lines.push(l));
  return { sim, conn, lines };
}

describe('grbl-simulator', () => {
  it('emits the welcome banner when the port opens', async () => {
    const { lines } = await openSim();
    await pump(5);
    expect(lines).toContain("Grbl 1.1f ['$' for help]");
  });

  it('acks every G-code line with ok', async () => {
    const { conn, lines } = await openSim();
    await pump(5);
    lines.length = 0;
    await conn.write('G21\nG90\n');
    await pump(5);
    expect(lines).toEqual(['ok', 'ok']);
  });

  it('answers $$ with the settings dump and a final ok', async () => {
    const { conn, lines } = await openSim();
    await pump(5);
    lines.length = 0;
    await conn.write('$$\n');
    await pump(5);
    expect(lines).toContain('$32=1');
    expect(lines).toContain('$30=1000');
    expect(lines.at(-1)).toBe('ok');
  });

  it('answers ? with an Idle status report including MPos/FS/WCO', async () => {
    const { conn, lines } = await openSim();
    await pump(5);
    lines.length = 0;
    await conn.write('?');
    await pump(5);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^<Idle\|MPos:0\.000,0\.000,0\.000\|FS:0,0\|WCO:0\.000,0\.000,0\.000>$/,
    );
  });

  it('jogs: moves position, reports Jog, then settles to Idle', async () => {
    const { sim, conn, lines } = await openSim({ motionMs: 50 });
    await pump(5);
    lines.length = 0;
    await conn.write('$J=G91 G21 X10.000 F1000\n');
    await pump(2);
    expect(lines).toContain('ok');
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toMatch(/^<Jog\|MPos:10\.000,0\.000/);
    await pump(60);
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toMatch(/^<Idle\|MPos:10\.000,0\.000/);
    expect(sim.state().mpos.x).toBe(10);
  });

  it('feed hold pauses to Hold:0 and ~ resumes to Run', async () => {
    const { conn, lines } = await openSim({ motionMs: 500 });
    await pump(5);
    await conn.write('G1 X5 F600 S100\n');
    await pump(2);
    await conn.write('!');
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toMatch(/^<Hold:0\|/);
    await conn.write('~');
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toMatch(/^<Run\|/);
  });

  it('soft reset during motion raises ALARM:3, locks G-code out, $X unlocks', async () => {
    const { conn, lines } = await openSim({ motionMs: 500 });
    await pump(5);
    await conn.write('G1 X5 F600 S100\n');
    await pump(2);
    await conn.write('\x18');
    await pump(5);
    expect(lines).toContain('ALARM:3');
    lines.length = 0;
    await conn.write('M9\n');
    await pump(5);
    expect(lines).toContain('error:9');
    await conn.write('$X\n');
    await pump(5);
    expect(lines).toContain('[MSG:Caution: Unlocked]');
    lines.length = 0;
    await conn.write('M9\n');
    await pump(5);
    expect(lines).toContain('ok');
  });

  it('soft reset while idle stays unlocked and re-banners', async () => {
    const { conn, lines } = await openSim();
    await pump(5);
    lines.length = 0;
    await conn.write('\x18');
    await pump(5);
    expect(lines).toContain("Grbl 1.1f ['$' for help]");
    expect(lines).not.toContain('ALARM:3');
  });

  it('homes: $H answers ok only after the homing delay, from home position', async () => {
    const { sim, conn, lines } = await openSim({ homingMs: 20 });
    await pump(5);
    await conn.write('$J=G91 G21 X10.000 F1000\n');
    await pump(30);
    lines.length = 0;
    await conn.write('$H\n');
    await pump(5);
    expect(lines).not.toContain('ok');
    await pump(30);
    expect(lines).toContain('ok');
    expect(sim.state().mpos).toEqual({ x: 0, y: 0, z: 0 });
    expect(sim.state().isHomed).toBe(true);
  });

  it('refuses $H with error:5 when homing is disabled', async () => {
    const { conn, lines } = await openSim({ settings: [[22, '0']] });
    await pump(5);
    lines.length = 0;
    await conn.write('$H\n');
    await pump(5);
    expect(lines).toContain('error:5');
  });

  it('tracks G92 work offset in the WCO status field and clears on G92.1', async () => {
    const { conn, lines } = await openSim({ motionMs: 1 });
    await pump(5);
    await conn.write('$J=G91 G21 X12.000 F1000\n');
    await pump(10);
    await conn.write('G54 G92 X0 Y0\n');
    await pump(5);
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toContain('|WCO:12.000,0.000,0.000');
    await conn.write('G54 G92.1\n');
    await pump(5);
    await conn.write('?');
    await pump(2);
    expect(lines.at(-1)).toContain('|WCO:0.000,0.000,0.000');
  });

  it('rejects configured lines with the given error code', async () => {
    const { conn, lines } = await openSim({
      rejectLines: [{ pattern: /X13\b/, errorCode: 20 }],
    });
    await pump(5);
    lines.length = 0;
    await conn.write('G1 X13 F500\n');
    await pump(5);
    expect(lines).toEqual(['error:20']);
  });

  it('$SLP puts the controller to sleep; soft reset wakes it', async () => {
    const { sim, conn, lines } = await openSim();
    await pump(5);
    await conn.write('$SLP\n');
    await pump(5);
    expect(sim.state().machine).toBe('Sleep');
    lines.length = 0;
    await conn.write('G21\n');
    await pump(5);
    expect(lines).toEqual([]); // asleep: no replies
    await conn.write('\x18');
    await pump(5);
    expect(sim.state().machine).toBe('Idle');
  });

  it('yankCable closes the port: writes fail and no lines are delivered', async () => {
    const { sim, conn, lines } = await openSim();
    await pump(5);
    let closed = false;
    conn.onClose(() => {
      closed = true;
    });
    sim.yankCable();
    expect(closed).toBe(true);
    lines.length = 0;
    await expect(conn.write('G21\n')).rejects.toThrow(/closed/i);
    await pump(5);
    expect(lines).toEqual([]);
  });

  it('captures the baud rate the host opened with', async () => {
    const { sim } = await openSim();
    expect(sim.port.openRequests()).toEqual([{ baudRate: 115200 }]);
  });
});
