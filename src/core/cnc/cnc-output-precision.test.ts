import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fmt } from '../output/cnc-grbl-emit-head';
import { parseGrblCncCoordinate } from './cnc-grbl-coordinate-parser';
import {
  CNC_COORDINATE_DECIMAL_PLACES,
  CNC_COORDINATE_QUANTUM_MM,
  CNC_MASK_EMISSION_XY_CLEARANCE_MM,
  CNC_MASK_EMISSION_Z_CLEARANCE_MM,
  cncCoordinateRepresentationMm,
  formatCncCoordinateMm,
  requestedCncCoordinateText,
  representedCncCoordinateMm,
  representedCncDepthMm,
} from './cnc-output-precision';

describe('CNC output precision contract', () => {
  it('binds planner mask clearance to the GRBL formatter quantum', () => {
    expect(fmt(CNC_COORDINATE_QUANTUM_MM)).toBe('0.001');
    expect(fmt(1)).toBe(`1.${'0'.repeat(CNC_COORDINATE_DECIMAL_PLACES)}`);
    expect(CNC_COORDINATE_QUANTUM_MM).toBe(10 ** -CNC_COORDINATE_DECIMAL_PLACES);
    expect(CNC_MASK_EMISSION_XY_CLEARANCE_MM).toBeGreaterThanOrEqual(
      (Math.SQRT2 * CNC_COORDINATE_QUANTUM_MM) / 2,
    );
    expect(CNC_MASK_EMISSION_Z_CLEARANCE_MM).toBeGreaterThanOrEqual(CNC_COORDINATE_QUANTUM_MM / 2);
  });

  it.each([
    [-0.05049, '-0.050'],
    [-0.0505, '-0.051'],
    [-0.0506, '-0.051'],
    [-0.00049, '-0.000'],
    [1.2344, '1.234'],
  ] as const)('shares the emitted text and represented number for %s', (value, text) => {
    expect(formatCncCoordinateMm(value)).toBe(text);
    expect(representedCncCoordinateMm(value)).toBe(parseGrblCncCoordinate(text));
  });

  it('retains one exact text/value pair without a second lossy formatting pass', () => {
    const represented = cncCoordinateRepresentationMm(-6553.606);

    expect(represented).toEqual({
      text: '-6553.606',
      value: parseGrblCncCoordinate('-6553.606'),
    });
    expect(formatCncCoordinateMm(represented.value)).not.toBe(represented.text);
  });

  it('preserves requested precision only when ordinary emission changes it', () => {
    expect(requestedCncCoordinateText(0.1)).toBe('0.100');
    expect(requestedCncCoordinateText(0.0506)).toBe('0.0506');
    expect(requestedCncCoordinateText(4e-7)).toBe('4e-7');
  });

  it.each([
    [0.00049, '0.000'],
    [0.0005, '0.001'],
    [0.0006, '0.001'],
    [0.05049, '0.050'],
    [0.0505, '0.051'],
  ] as const)('reports requested depth %s as emitted depth %s', (requested, effective) => {
    expect(representedCncDepthMm(requested)).toBe(-parseGrblCncCoordinate(`-${effective}`));
  });

  it('keeps every represented ordinary coordinate within half a quantum (200 seeds)', () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000_000, max: 10_000_000 }), (units) => {
        const requested = units / 10_000;
        const represented = representedCncCoordinateMm(requested);
        expect(represented).toBe(parseGrblCncCoordinate(formatCncCoordinateMm(requested)));
        expect(Math.abs(represented - requested)).toBeLessThanOrEqual(
          CNC_COORDINATE_QUANTUM_MM / 2 + 4 * 2 ** -23 * Math.max(1, Math.abs(requested)),
        );
      }),
      { numRuns: 200 },
    );
  });
});
