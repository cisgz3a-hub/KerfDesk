import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { CNC_MASK_EMISSION_XY_CLEARANCE_MM } from '../cnc/cnc-output-precision';
import { kernelForTool } from './tool-kernels';

const CELL = 0.2;
const CONE_DZ_PRECISION_DIGITS = 9;

// depth = (width / 2) / tan(included / 2). PreciseBits publish the inverse,
// width = 2 x depth x tan(half-angle), so these multipliers are exact
// cotangents written out independently of the implementation. 90° is kept but
// cannot stand alone: cot 45° = 1 collapses the law to dz = d, which an
// included-angle and a side-angle reading satisfy equally. The others separate
// them — under the side-angle reading 60° would give cot 60° = 0.577, not 1.732.
const ENGRAVING_CONE_CASES: ReadonlyArray<readonly [number, number]> = [
  [30, 2 + Math.sqrt(3)], // cot 15°
  [60, Math.sqrt(3)], // cot 30°
  [90, 1], // cot 45°
  [120, 1 / Math.sqrt(3)], // cot 60°
];

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

  // A conical engraving bit is a cone, not a flat end mill. 2L Inc and
  // PreciseBits both specify these cutters by INCLUDED angle, and the rest of
  // the tree already treats them as angled — vcarveIncludedAngleDeg cones them
  // for the depth law, and the UI labels them by included angle. Modelling
  // dz = 0 here made the removal grid simulate a flat-bottomed trench the full
  // width of the shank while the emitted G-code cut a cone.
  it.each(ENGRAVING_CONE_CASES)(
    'engraving bit at %i° included: dz is d x %f, not a flat bottom',
    (includedAngleDeg, cotHalfAngle) => {
      const kernel = kernelForTool(tool('engraving', 6.35, includedAngleDeg), CELL);
      expect(kernel.offsets.length).toBeGreaterThan(0);
      for (const o of kernel.offsets) {
        const dMm = Math.hypot(o.dx, o.dy) * CELL;
        expect(o.dz).toBeCloseTo(dMm * cotHalfAngle, CONE_DZ_PRECISION_DIGITS);
      }
    },
  );

  it('engraving with no stored angle falls back to the 60° cone', () => {
    const kernel = kernelForTool(tool('engraving', 6.35), CELL);
    expect(kernel.offsets.length).toBeGreaterThan(0);
    for (const o of kernel.offsets) {
      const dMm = Math.hypot(o.dx, o.dy) * CELL;
      expect(o.dz).toBeCloseTo(dMm * Math.sqrt(3), CONE_DZ_PRECISION_DIGITS);
    }
  });

  it('engraving and v-bit of identical geometry carve an identical shape', () => {
    const engraving = kernelForTool(tool('engraving', 3.175, 15), CELL);
    const vBit = kernelForTool(tool('v-bit', 3.175, 15), CELL);
    expect(engraving.offsets).toEqual(vBit.offsets);
  });

  it('footprint never exceeds the tool radius', () => {
    const kernel = kernelForTool(tool('end-mill', 2), CELL);
    for (const o of kernel.offsets) {
      expect(Math.hypot(o.dx, o.dy) * CELL).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('covers excluded cell squares that intersect a fractional-radius footprint', () => {
    const mmPerCell = 1 / 5.8;
    const kernel = kernelForTool(tool('end-mill', 2), mmPerCell);

    expect(kernel.offsets.some(({ dx, dy }) => dx === 6 && dy === 0)).toBe(false);
    expect(kernel.maskCellOffsets).toContainEqual({ dx: 6, dy: 0, dz: 0 });
    for (const offset of kernel.maskCellOffsets ?? []) {
      const nearestX = Math.max(0, Math.abs(offset.dx) * mmPerCell - mmPerCell / 2);
      const nearestY = Math.max(0, Math.abs(offset.dy) * mmPerCell - mmPerCell / 2);
      expect(
        Math.max(0, Math.hypot(nearestX, nearestY) - CNC_MASK_EMISSION_XY_CLEARANCE_MM),
      ).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
