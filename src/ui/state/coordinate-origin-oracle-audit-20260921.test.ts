import { describe, expect, it } from 'vitest';
import {
  clearPersistentOrigin,
  resetOrigin,
  setOriginHere,
  setPersistentOriginHere,
  zeroZHere,
} from './origin-actions';

type Vector = { x: number; y: number; z: number };
const AXES = ['x', 'y', 'z'] as const;

// Independent tiny coordinate oracle, limited to the commands under audit.
// GRBL gcode.c: WPos=MPos-WCS-G92-TLO; G10 L20 sets WCS=MPos-G92-TLO-WPos.
// G92.1 clears all transient axes. G10's omitted axes retain their stored value.
// No production coordinate/placement helpers are used to calculate expectations.
class CoordinateOracle {
  machine: Vector;
  g54: Vector = { x: 100, y: 200, z: 12 };
  g55: Vector = { x: 400, y: 500, z: 25 };
  transient: Vector = { x: 7, y: 8, z: 9 };
  active: 'g54' | 'g55' = 'g55';
  toolZ = 3;
  unitsScale: number;

  constructor(machine: Vector, inches: boolean) {
    this.machine = { ...machine };
    this.unitsScale = inches ? 25.4 : 1;
  }

  work(): Vector {
    return {
      x: this.machine.x - this[this.active].x - this.transient.x,
      y: this.machine.y - this[this.active].y - this.transient.y,
      z: this.machine.z - this[this.active].z - this.transient.z - this.toolZ,
    };
  }

  write = async (line: string): Promise<void> => {
    if (/\bG54\b/.test(line)) this.active = 'g54';
    if (/\bG92\.1\b/.test(line)) {
      this.transient = { x: 0, y: 0, z: 0 };
      return;
    }
    for (const axis of AXES) {
      const token = new RegExp(`\\b${axis.toUpperCase()}(-?\\d+(?:\\.\\d+)?)`).exec(line)?.[1];
      if (token === undefined) continue;
      const commanded = Number(token) * this.unitsScale;
      const toolOffset = axis === 'z' ? this.toolZ : 0;
      if (/\bG92\b/.test(line)) {
        this.transient[axis] =
          this.machine[axis] - this[this.active][axis] - toolOffset - commanded;
      } else if (/\bG10 L20 P1\b/.test(line)) {
        this.g54[axis] = this.machine[axis] - this.transient[axis] - toolOffset - commanded;
      } else if (/\bG10 L2 P1\b/.test(line)) {
        this.g54[axis] = commanded;
      } else {
        throw new Error(`Unexpected audited command: ${line}`);
      }
    }
  };
}

const positions: Vector[] = [
  { x: 0, y: 0, z: 0 },
  { x: 150, y: 250, z: 30 },
  { x: -200, y: -100, z: -30 },
  { x: 12.345, y: -67.891, z: 4.321 },
];

describe('independent GRBL coordinate oracle, 2026-09-21', () => {
  it.each(positions.flatMap((position) => [false, true].map((inches) => ({ position, inches }))))(
    'Set origin yields work XY zero at $position in inch mode $inches',
    async ({ position, inches }) => {
      const model = new CoordinateOracle(position, inches);
      const physicalBefore = { ...model.machine };
      await setOriginHere(model.write, true);
      expect(model.active).toBe('g54');
      expect(model.work().x).toBeCloseTo(0, 8);
      expect(model.work().y).toBeCloseTo(0, 8);
      expect(model.machine).toEqual(physicalBefore);
      expect(model.transient.z).toBe(9);
    },
  );

  it('Reset transient origin restores stored G54, which can be far from machine zero', async () => {
    const model = new CoordinateOracle({ x: 150, y: 250, z: 30 }, false);
    await setOriginHere(model.write, true);
    await resetOrigin(model.write, true);
    expect(model.work()).toEqual({ x: 50, y: 50, z: 15 });
    expect(model.g54).toEqual({ x: 100, y: 200, z: 12 });
    expect(model.transient).toEqual({ x: 0, y: 0, z: 0 });
  });

  it.each([false, true])(
    'persistent XY writes survive a simulated parser reset, inches %s',
    async (inches) => {
      const model = new CoordinateOracle({ x: -150, y: 250, z: 30 }, inches);
      await setPersistentOriginHere(model.write, true);
      expect(model.g54).toEqual({ x: -150, y: 250, z: 12 });
      model.transient = { x: 0, y: 0, z: 0 };
      model.active = 'g54';
      expect(model.work()).toEqual({ x: 0, y: 0, z: 15 });
    },
  );

  it('persistent XY clear does not erase stored G54 Z or tool length compensation', async () => {
    const model = new CoordinateOracle({ x: 150, y: 250, z: 30 }, false);
    await clearPersistentOrigin(model.write, true);
    expect(model.g54).toEqual({ x: 0, y: 0, z: 12 });
    expect(model.work()).toEqual({ x: 150, y: 250, z: 15 });
  });

  it('manual zero Z leaves established G54 XY zero unchanged', async () => {
    const model = new CoordinateOracle({ x: 150, y: 250, z: 30 }, false);
    await setOriginHere(model.write, true);
    await zeroZHere(model.write, true);
    expect(model.work()).toEqual({ x: 0, y: 0, z: 0 });
    expect(model.machine).toEqual({ x: 150, y: 250, z: 30 });
  });
});
