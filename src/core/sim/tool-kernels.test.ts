import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { kernelForTool } from './tool-kernels';

const CELL = 0.2;

function tool(kind: CncTool['kind'], diameterMm: number, tipAngleDeg?: number): CncTool {
  return {
    id: 't',
    name: 't',
    kind,
    diameterMm,
    ...(tipAngleDeg === undefined ? {} : { tipAngleDeg }),
  };
}

describe('kernelForTool', () => {
  it('flat end mill: dz is 0 across the whole footprint', () => {
    const kernel = kernelForTool(tool('end-mill', 3.175), CELL);
    expect(kernel.offsets.length).toBeGreaterThan(0);
    expect(kernel.offsets.every((o) => o.dz === 0)).toBe(true);
  });

  it('ball nose: dz is 0 at the center and approaches r at the rim', () => {
    const r = 3.175 / 2;
    const kernel = kernelForTool(tool('ball-nose', 3.175), CELL);
    const center = kernel.offsets.find((o) => o.dx === 0 && o.dy === 0);
    expect(center?.dz).toBe(0);
    const rim = kernel.offsets.reduce((max, o) => Math.max(max, o.dz), 0);
    expect(rim).toBeGreaterThan(r * 0.5);
    expect(rim).toBeLessThanOrEqual(r);
  });

  it('90° v-bit: dz equals the horizontal distance (tan 45° = 1)', () => {
    const kernel = kernelForTool(tool('v-bit', 6.35, 90), CELL);
    for (const o of kernel.offsets) {
      const dMm = Math.hypot(o.dx, o.dy) * CELL;
      expect(o.dz).toBeCloseTo(dMm, 9);
    }
  });

  it('footprint never exceeds the tool radius', () => {
    const kernel = kernelForTool(tool('end-mill', 2), CELL);
    for (const o of kernel.offsets) {
      expect(Math.hypot(o.dx, o.dy) * CELL).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
