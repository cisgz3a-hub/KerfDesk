import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../scene';
import { runStandaloneCncPreflight } from './standalone-cnc-preflight';

describe('standalone CNC replayable preflight', () => {
  it('keeps modal Z, arc bounds and exact issue line numbers across iteration boundaries', () => {
    const lines = [
      'G21',
      'G90',
      'G0 Z3.810',
      'M3 S12000',
      'G1 Z-1 F300',
      'X10 F100',
      'G0 X20',
      'M3 S12000',
      'G1 XNaN',
      'G0 X10 Y0',
      'G2 X0 Y10 I-10 J0 F100',
    ];
    const device = { ...DEFAULT_DEVICE_PROFILE, bedWidth: 15, bedHeight: 15 };
    const replayable = {
      *[Symbol.iterator]() {
        yield* lines;
      },
    };
    const actual = runStandaloneCncPreflight(device, DEFAULT_CNC_MACHINE_CONFIG, replayable);
    expect(actual).toEqual(
      runStandaloneCncPreflight(device, DEFAULT_CNC_MACHINE_CONFIG, lines.join('\n')),
    );
    expect(actual.issues).toContainEqual(
      expect.objectContaining({
        code: 'plunged-travel',
        message: expect.stringContaining('Line 7:'),
      }),
    );
    expect(actual.issues).toContainEqual(
      expect.objectContaining({
        code: 'non-finite-coordinate',
        message: expect.stringContaining('Line 9:'),
      }),
    );
  });

  it('bounds retained diagnostics for arbitrarily many repeated violations', () => {
    let reads = 0;
    const replayable = {
      *[Symbol.iterator]() {
        for (let i = 0; i < 10000; i++) {
          reads++;
          yield 'G1 X999999 YNaN F999999';
        }
      },
    };
    const result = runStandaloneCncPreflight(
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
      replayable,
    );
    expect(result.issues.filter((issue) => issue.code === 'cnc-settings-invalid')).toHaveLength(5);
    expect(result.issues.filter((issue) => issue.code === 'out-of-bed')).toHaveLength(5);
    expect(result.issues.filter((issue) => issue.code === 'non-finite-coordinate')).toHaveLength(5);
    expect(result.issues.length).toBe(15);
    expect(reads).toBeGreaterThan(10000); // independent scans replay rather than cache lines
  });
});
