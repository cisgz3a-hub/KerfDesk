// Audit 2026-10-21, 03-P3-1 (ADR-462 Amendment 1): on Marlin with Air restart
// ticked, the keep-alive repeated M8 between lit burn moves. Marlin runs the
// body's M4 as continuous inline power (`M3 I`) or fan PWM, which stays lit
// when the head stops, and its M8 synchronizes on every call (M7-M9.cpp), so
// each repeat was a lit stop. With `stopKeepsPower` the repeat waits for a
// dark move under M4 as it does under M3. The oracle for the full Marlin
// output is src/__fixtures__/controllers/marlin-lit-drain-checker.ts.

import { describe, expect, it } from 'vitest';
import { findMarlinLitPlannerDrains } from '../../__fixtures__/controllers/marlin-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CutGroup } from '../job';
import { withAirKeepAlive, type AirKeepAliveLimits } from './air-keep-alive';
import { marlinStrategy } from './marlin-strategy';

// 60 mm/s moves with no acceleration term: every 60 mm of G1 costs exactly 1 s.
const LIMITS: AirKeepAliveLimits = { maxFeedMmPerMin: 36000, accelMmPerSec2: 0 };
const MARLIN_LIMITS: AirKeepAliveLimits = { ...LIMITS, stopKeepsPower: true };

function burns(count: number, after = 0): string[] {
  return Array.from({ length: count }, (_, index) => `G1 X${(after + index + 1) * 60}.000 S500`);
}

function indicesOf(lines: ReadonlyArray<string>, word: string): number[] {
  return lines.flatMap((line, index) => (line === word ? [index] : []));
}

describe('03-P3-1: the Marlin keep-alive never repeats between lit moves', () => {
  it('holds a repeat under M4 until a laser-off move has left the beam dark', () => {
    const source = [
      'M4 S0',
      'M8',
      'G1 F3600',
      ...burns(8),
      'G0 X0.000 Y10.000 S0',
      'G1 X60.000 S500',
      'M9',
      '',
    ].join('\n');
    const lines = withAirKeepAlive(source, MARLIN_LIMITS).split('\n');

    expect(indicesOf(lines, 'M8')).toEqual([1, 12]);
    expect(lines[11]).toBe('G0 X0.000 Y10.000 S0');
    // GRBL's M4 is dark at a stop, so there the repeat still goes between burns.
    expect(indicesOf(withAirKeepAlive(source, LIMITS).split('\n'), 'M8')).toEqual([1, 8]);
  });

  it('does not count a travel to where the head already is as dark', () => {
    const source = [
      'M4 S0',
      'M8',
      'G1 F3600',
      ...burns(8),
      'G0 X480.000 S0',
      'G1 X540.000 S500',
      'G0 X0.000 Y10.000 S0',
      'G1 X60.000 S500',
      'M9',
      '',
    ].join('\n');
    const lines = withAirKeepAlive(source, MARLIN_LIMITS).split('\n');

    expect(indicesOf(lines, 'M8')).toEqual([1, 14]);
    expect(lines[13]).toBe('G0 X0.000 Y10.000 S0');
  });

  it.each([
    ['marlin-inline' as const, 'S77'],
    ['marlin-fan' as const, 'M106 S77'],
  ])('%s output with Air restart ticked has no lit air repeat', (dialectId, burnPower) => {
    const device: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      airAssistCommand: 'M8',
      airAssistRestartUnreliable: true,
      gcodeDialect: { dialectId },
    };
    const zigzag: CutGroup = {
      kind: 'cut',
      layerId: 'A',
      color: '#ff0000',
      power: 30,
      speed: 1200,
      passes: 2,
      airAssist: true,
      segments: [
        {
          polyline: Array.from({ length: 40 }, (_, i) => ({ x: i * 10, y: i % 2 === 0 ? 0 : 5 })),
          closed: false,
        },
      ],
    };
    const out = marlinStrategy.emit({ groups: [zigzag] }, device);

    expect(out).toContain(burnPower);
    expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    // The second pass's travel back to the start is the dark move the repeat waits for.
    expect(out.match(/^M8$/gm)?.length).toBeGreaterThan(1);
    expect(out).toMatch(/\nG0 X0\.000 Y0\.000 F6000(?: S0)?\nM8\n/);
  });
});
