import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job/compile-job';
import { generateFocusTest } from '../job/focus-test';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { withAirKeepAlive } from './air-keep-alive';
import { grblStrategy } from './grbl-strategy';

const LIMITS = { maxFeedMmPerMin: 36000, accelMmPerSec2: 0 };

describe('air keep-alive distance mode', () => {
  it('counts repeated relative XYZ moves and applies a mode word anywhere in its block', () => {
    // Each (3, 4, 12) displacement is 13 mm and takes 13 seconds.
    const source = 'G90\nM4 S0\nM8\nG1 X3 Y4 Z12 F60 G91\nX3 Y4 Z12\nX3 Y4 Z12\nM9\n';
    expect(withAirKeepAlive(source, LIMITS, 13)).toBe(
      source.replaceAll('\nX3 Y4 Z12', '\nM8\nX3 Y4 Z12'),
    );
  });

  it('restores absolute endpoints without counting mode-only blocks as motion', () => {
    const source = [
      'G90',
      'G0 X10 Y20 Z30',
      'M4 S0',
      'M8',
      'G91 G1 Z5 F60',
      'G90',
      'G1 Z35',
      'G1 Z36',
      'G1 Z37',
      'M9',
      '',
    ].join('\n');
    // Relative +5 reaches Z35. Absolute Z35 is stationary, then Z36/Z37
    // each take one second: six seconds have accrued before the final move.
    expect(withAirKeepAlive(source, LIMITS, 6)).toBe(source.replace('\nG1 Z37', '\nM8\nG1 Z37'));
  });

  it('uses relative arc endpoints while retaining incremental I/J centers', () => {
    const source = 'G90\nG0 X10 Y10\nM4 S0\nM8\nG91\nG3 X-10 Y10 I-10 J0 F60\nG1 X1\nM9\n';
    // Radius 10, quarter-circle: 5*pi seconds, just above 15 seconds.
    expect(withAirKeepAlive(source, LIMITS, 15)).toBe(source.replace('\nG1 X1', '\nM8\nG1 X1'));
    expect(withAirKeepAlive(source, LIMITS, 16)).toBe(source);
  });

  it.each(['grbl-dynamic', 'grbl-compatible'] as const)(
    'refreshes after slow Z travel in an emitted symmetric Focus sweep (%s)',
    (dialectId) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        gcodeDialect: { dialectId },
        airAssistCommand: 'M8' as const,
        airAssistRestartUnreliable: true,
      };
      const generated = generateFocusTest({
        steps: 2,
        minOffsetMm: -1,
        maxOffsetMm: 1,
        speed: 6000,
        power: 10,
        lineLengthMm: 1,
        spacingMm: 1,
        travelFeedMmPerMin: 5,
      });
      const scene = {
        ...generated,
        layers: generated.layers.map((layer) => ({ ...layer, airAssist: true })),
      };
      const program = grblStrategy.emit(compileJob(scene, device), device);
      const lines = program.split('\n');
      const zMoves = lines.flatMap((line, index) => (/^G1 Z/.test(line) ? [index] : []));
      expect(zMoves.map((index) => lines[index])).toEqual([
        'G1 Z-1.000 F5 S0',
        'G1 Z1.000 F5 S0',
        'G1 Z1.000 F5 S0',
        'G1 Z-1.000 F5 S0',
      ]);
      // Every Z move takes 12 seconds. The first three have another motion
      // boundary while air is on; the final return is followed by air-off.
      for (const index of zMoves.slice(0, 3)) {
        const next = lines.findIndex(
          (line, candidate) => candidate > index && /^G[01] [XYZ]/.test(line),
        );
        expect(next).toBeGreaterThan(index);
        expect(lines[next - 1]).toBe('M8');
      }
      expect(findM3LitPlannerDrains(program)).toEqual([]);
    },
  );
});
