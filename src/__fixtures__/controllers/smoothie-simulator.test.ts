// Controller audit SM-4: the Smoothieware simulator must be no more forgiving
// than the firmware (edge 38e2cc08). Each case pins one upstream behaviour.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from './smoothie-simulator';

type Harness = {
  readonly sim: SmoothieSimulator;
  readonly lines: string[];
  readonly send: (data: string) => Promise<string[]>;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function open(options: CreateSmoothieSimulatorOptions = {}): Promise<Harness> {
  const sim = createSmoothieSimulator(options);
  const lines: string[] = [];
  const port = await sim.adapter.serial.requestPort();
  if (port === null) throw new Error('No simulated port');
  const connection = await port.open({ baudRate: 115200 });
  connection.onLine((line) => lines.push(line));
  await vi.advanceTimersByTimeAsync(5);
  const send = async (data: string): Promise<string[]> => {
    const before = lines.length;
    await connection.write(data);
    await vi.advanceTimersByTimeAsync(50);
    return lines.slice(before);
  };
  return { sim, lines, send };
}

describe('Smoothieware simulator fidelity (SM-4)', () => {
  it('greets a USB attach with `Smoothie` then `ok` (USBSerial.cpp L328-L333)', async () => {
    const { lines } = await open();
    expect(lines).toEqual(['Smoothie', 'ok']);
  });

  it('halts on Ctrl-X even at rest, without a banner, and drops the rest of the write', async () => {
    const { sim, send } = await open();
    expect(await send('\x18G0 X10\n')).toEqual(['HALTED, M999 or $X to exit HALT state']);
    expect(sim.state()).toMatchObject({ isHalted: true, pos: { x: 0 } });
    const grbl = await open({ grblMode: true });
    expect(await grbl.send('\x18')).toEqual(['ALARM: Abort during cycle']);
  });

  it('runs the halt-exempt M-codes while halted and refuses the rest (GcodeDispatch.cpp L34)', async () => {
    const { sim, send } = await open();
    await send('\x18');
    expect(await send('M5\n')).toEqual(['ok']);
    expect(await send('M9\n')).toEqual(['ok']);
    expect(await send('M114\n')).toEqual(['ok C: X:0.0000 Y:0.0000 Z:0.0000']);
    expect((await send('M115\n')).at(-1)).toBe('ok');
    expect(await send('G0 X5\n')).toEqual(['!!']);
    expect(await send('fire off\n')).toEqual([]);
    expect(await send('M999\n')).toEqual([
      'WARNING: After HALT you should HOME as position is currently unknown',
      'ok',
    ]);
    expect(sim.state().isHalted).toBe(false);
  });

  it('keeps G92 as an offset: WPos moves, MPos does not (Robot.cpp L624-L662)', async () => {
    const { sim, send } = await open();
    await send('G0 X12 Y5\n');
    await send('G92 X0 Y0\n');
    expect(sim.state()).toMatchObject({ pos: { x: 12, y: 5 }, workPos: { x: 0, y: 0 } });
    expect(await send('?')).toEqual([
      '<Idle|MPos:12.0000,5.0000,0.0000|WPos:0.0000,0.0000,0.0000|F:4000.0,100.0>',
    ]);
    await send('G0 X10 Y0\n');
    expect(sim.state()).toMatchObject({ pos: { x: 22, y: 5 }, workPos: { x: 10, y: 0 } });
    expect(await send('M114\n')).toEqual(['ok C: X:10.0000 Y:0.0000 Z:0.0000']);
    await send('G92.1\n');
    expect(sim.state().workPos).toMatchObject({ x: 22, y: 5 });
  });

  it('reports the running form with live feed, L and S (Kernel.cpp L206-L259)', async () => {
    const { send } = await open({ motionMs: 500 });
    await send('G1 X10 F600 S0.5\n');
    expect(await send('?')).toEqual([
      '<Run|MPos:10.0000,0.0000,0.0000|WPos:10.0000,0.0000,0.0000|F:600.0,600.0,100.0|L:50.0000|S:0.5000>',
    ]);
  });

  it('models a board without the Laser module (Laser.cpp L51-L74)', async () => {
    const { sim, send } = await open({ laserModule: 'absent' });
    expect(await send('fire off\n')).toEqual([]);
    expect(await send('M221\n')).toEqual(['ok']);
    await send('G1 X10 F600 S0.5\n');
    expect(sim.state().burns).toEqual([]);
  });

  it('models the M221 reports of the edge and pre-971eb8cf builds', async () => {
    const edge = await open();
    expect(await edge.send('M221\n')).toEqual([
      'Laser power: 100.00 %, disable auto power: 0, PWM frequency: 50000.000000 Hz',
      'ok',
    ]);
    const old = await open({ laserModule: 'pre-2021' });
    expect(await old.send('M221\n')).toEqual(['Laser power scale at 100.00 %', 'ok']);
    await old.send('M221 S100 P1\n');
    expect(old.sim.state().proportionalPower).toBe(true);
  });

  it('answers `$H` without homing when the Endstops module is absent', async () => {
    const { sim, send } = await open({ endstops: false });
    await send('G0 X40\n');
    expect(await send('$H\n')).toEqual(['ok']);
    expect(await send('G28.6\n')).toEqual(['ok']);
    expect(sim.state()).toMatchObject({ homingCycles: 0, isHomed: false, pos: { x: 40 } });
  });

  it('reports homed axes with G28.6 (Endstops.cpp L1114-L1120)', async () => {
    const { send } = await open();
    expect(await send('G28.6\n')).toEqual(['X:0 Y:0 ', 'ok']);
    await send('$H\n');
    expect(await send('G28.6\n')).toEqual(['X:1 Y:1 ', 'ok']);
  });

  it('fails a homing cycle that a halt interrupts (Endstops.cpp L895-L902)', async () => {
    const { sim, send, lines } = await open({ homingMs: 200 });
    expect(await send('$H\n')).toEqual([]);
    sim.pressKillButton();
    await vi.advanceTimersByTimeAsync(300);
    expect(lines.slice(-2)).toEqual([
      'ERROR: Homing cycle failed - check the max_travel settings',
      'ok',
    ]);
    expect(sim.state()).toMatchObject({ isHalted: true, isHomed: false, homingCycles: 0 });
  });

  it('prints the unsolicited ALARM texts and halts (Endstops.cpp L426, KillButton.cpp L62)', async () => {
    const { sim, lines } = await open();
    sim.hardLimit('-Y');
    sim.pressKillButton();
    await vi.advanceTimersByTimeAsync(10);
    expect(lines).toContain('ALARM: Hard limit -Y');
    expect(lines).toContain('ALARM: Kill button pressed - reset, $X or M999 to clear HALT');
    expect(sim.state().isHalted).toBe(true);
  });

  it('stores S in 12 bits: S255 on a 255 scale fires at 1/255 (Planner.cpp L81)', async () => {
    const { sim, send } = await open({ maximumS: 255 });
    await send('G1 X10 F600 S255\n');
    expect(sim.state().burnPowers[0]).toBeCloseTo(1 / 255, 6);
  });
});
