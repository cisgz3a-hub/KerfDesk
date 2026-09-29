// The jog-cancel flush model must behave like grblHAL before store tests may
// trust it (ADR-025 discipline). Source:
// https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L896-L899
// and protocol.c#L212-L219.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import { createGrblSimulator, type CreateGrblSimulatorOptions } from './grbl-simulator';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const JOG = '$J=G91 G21 X10.000 F1000\n';
const GRBLHAL_FLUSH = { firmware: 'grblhal', jogCancelFlushesInput: true } as const;

async function openSim(options: CreateGrblSimulatorOptions): Promise<{
  readonly sim: ReturnType<typeof createGrblSimulator>;
  readonly conn: SerialConnection;
  readonly lines: string[];
}> {
  const sim = createGrblSimulator({ motionMs: 500, ...options });
  const portRef = await sim.adapter.serial.requestPort();
  if (portRef === null) throw new Error('requestPort returned null');
  const conn = await portRef.open({ baudRate: 115200 });
  const lines: string[] = [];
  conn.onLine((line) => lines.push(line));
  await vi.advanceTimersByTimeAsync(5);
  lines.length = 0;
  return { sim, conn, lines };
}

describe('grbl simulator jog-cancel flush model (grblHAL)', () => {
  it('0x85 discards a line not parsed yet, which is never answered', async () => {
    const { sim, conn, lines } = await openSim(GRBLHAL_FLUSH);
    await conn.write(JOG);
    await conn.write('\x85');
    await vi.advanceTimersByTimeAsync(20);
    expect(lines).toEqual([]);
    expect(sim.state().machine).toBe('Idle');

    await conn.write('G21\n');
    await vi.advanceTimersByTimeAsync(5);
    expect(lines).toEqual(['ok']);
  });

  it('0x85 after the jog was parsed cancels it like stock GRBL', async () => {
    const { sim, conn, lines } = await openSim(GRBLHAL_FLUSH);
    await conn.write(JOG);
    await vi.advanceTimersByTimeAsync(5);
    expect(lines).toEqual(['ok']);
    expect(sim.state().machine).toBe('Jog');

    await conn.write('\x85');
    expect(sim.state().machine).toBe('Idle');
  });

  it('0x85 clears the held error, as the CAN it leaves does', async () => {
    const { conn, lines } = await openSim({
      ...GRBLHAL_FLUSH,
      rejectLines: [{ pattern: /^G1 X9/, errorCode: 33 }],
    });
    await conn.write('G1 X9 F100\n');
    await conn.write('G21\n');
    await vi.advanceTimersByTimeAsync(5);
    expect(lines).toEqual(['error:33', 'error:33']);

    await conn.write('\x85');
    await conn.write('G21\n');
    await vi.advanceTimersByTimeAsync(5);
    expect(lines.slice(2)).toEqual(['ok']);
  });

  it('stock GRBL, the default, parses the jog before a following 0x85', async () => {
    const { sim, conn, lines } = await openSim({});
    await conn.write(JOG);
    await conn.write('\x85');
    await vi.advanceTimersByTimeAsync(5);
    expect(lines).toEqual(['ok']);
    expect(sim.state().machine).toBe('Idle');
  });

  it('refuses to combine with the planner back-pressure model', () => {
    expect(() => createGrblSimulator({ jogCancelFlushesInput: true, plannerBlocks: 16 })).toThrow(
      /plannerBlocks/,
    );
  });
});
