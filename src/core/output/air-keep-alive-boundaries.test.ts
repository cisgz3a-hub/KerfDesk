import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { withAirKeepAlive } from './air-keep-alive';

const LIMITS = { maxFeedMmPerMin: 36000, accelMmPerSec2: 0 };

describe('air repeats are best effort at eligible command boundaries', () => {
  it('leaves a single 100-second G1 intact and repeats only before the following move', () => {
    const source = 'M4 S0\nM8\nG1 X100 F60 S500\nG1 X101 S0\nM9\n';

    expect(withAirKeepAlive(source, LIMITS)).toBe(
      'M4 S0\nM8\nG1 X100 F60 S500\nM8\nG1 X101 S0\nM9\n',
    );
    // If the job ends there, no insertion opportunity exists after the long burn.
    const lastBurn = 'M4 S0\nM8\nG1 X100 F60 S500\nM9\n';
    expect(withAirKeepAlive(lastBurn, LIMITS)).toBe(lastBurn);
  });

  it('cannot refresh air inside a 30-second dwell', () => {
    const source = 'M4 S0\nM8\nG4 P30\nG1 X1 F60 S0\nM9\n';

    expect(withAirKeepAlive(source, LIMITS)).toBe('M4 S0\nM8\nG4 P30\nM8\nG1 X1 F60 S0\nM9\n');
  });

  it('defers through over 30 seconds of M3 burns until a completed dark move', () => {
    const source = [
      'M3 S0',
      'M8',
      'G1 X10 F60 S500',
      'X20',
      'X30',
      'G0 X40 S0',
      'G1 X41 S500',
      'G0 X42 S0',
      'M9',
      'M5',
      '',
    ].join('\n');
    const repeated = withAirKeepAlive(source, LIMITS);

    expect(repeated).toBe(source.replace('\nG1 X41', '\nM8\nG1 X41'));
    expect(findM3LitPlannerDrains(repeated)).toEqual([]);
  });

  it('also defers after a full-circle M3 burn until the next dark move', () => {
    const source = [
      'M3 S0',
      'G0 X10 Y0',
      'M8',
      'G2 X10 Y0 I-10 J0 F60 S500',
      'G0 X11 S0',
      'G1 X12 S500',
      'G0 X13 S0',
      'M9',
      'M5',
      '',
    ].join('\n');

    expect(withAirKeepAlive(source, LIMITS)).toBe(source.replace('\nG1 X12', '\nM8\nG1 X12'));
  });
});
