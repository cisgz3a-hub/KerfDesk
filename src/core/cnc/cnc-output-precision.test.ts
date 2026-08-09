import { describe, expect, it } from 'vitest';
import { fmt } from '../output/cnc-grbl-emit-head';
import {
  CNC_COORDINATE_DECIMAL_PLACES,
  CNC_COORDINATE_QUANTUM_MM,
  CNC_MASK_EMISSION_XY_CLEARANCE_MM,
  CNC_MASK_EMISSION_Z_CLEARANCE_MM,
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
});
