import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { findLaserOnTravelIssues } from '../invariants';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';
import { marlinStrategy } from './marlin-strategy';
import { selectOutputStrategy } from './select-output-strategy';
import { toMarlinFanGcode } from './marlin-fan-transform';

const JOB: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 30, y: 40 },
            { x: 50, y: 60 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

const MARLIN_INLINE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  gcodeDialect: { dialectId: 'marlin-inline' },
};

const MARLIN_FAN_DEVICE: DeviceProfile = {
  ...MARLIN_INLINE_DEVICE,
  gcodeDialect: { dialectId: 'marlin-fan' },
};

describe('marlinStrategy', () => {
  it('inline dialect emits the GRBL wire shape (M3/M4/M5 + per-move S)', () => {
    expect(marlinStrategy.emit(JOB, MARLIN_INLINE_DEVICE)).toBe(
      grblStrategy.emit(JOB, MARLIN_INLINE_DEVICE),
    );
  });

  it('fan dialect converts power to M106/M107 and strips S from motion lines', () => {
    const out = marlinStrategy.emit(JOB, MARLIN_FAN_DEVICE);
    // No G0/G1 line may carry an S word — power lives on M106 lines only.
    expect(out).not.toMatch(/^G[01][^\n]*\bS\d/m);
    expect(out).toContain('M106 S128'); // 50% of 255
    expect(out).toContain('M107');
    expect(out).not.toMatch(/^M[345]\b/m);
  });

  it('fan dialect output satisfies the laser-off-on-travel invariant (#3)', () => {
    const out = marlinStrategy.emit(JOB, MARLIN_FAN_DEVICE);
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('fan dialect emits fan-off before every travel move', () => {
    const out = marlinStrategy.emit(JOB, MARLIN_FAN_DEVICE).split('\n');
    out.forEach((line, i) => {
      if (!line.startsWith('G0')) return;
      const before = out.slice(0, i);
      const lastPower = [...before].reverse().find((l) => /^M10[67]\b/.test(l));
      expect(lastPower === undefined || lastPower === 'M107').toBe(true);
    });
  });

  it('is deterministic (non-negotiable #5)', () => {
    expect(marlinStrategy.emit(JOB, MARLIN_FAN_DEVICE)).toBe(
      marlinStrategy.emit(JOB, MARLIN_FAN_DEVICE),
    );
  });
});

describe('selectOutputStrategy', () => {
  it('routes marlin profiles to the marlin strategy, everything else to grbl', () => {
    expect(selectOutputStrategy(MARLIN_INLINE_DEVICE).id).toBe('marlin');
    expect(selectOutputStrategy(DEFAULT_DEVICE_PROFILE).id).toBe('grbl');
    expect(selectOutputStrategy({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'fluidnc' }).id).toBe(
      'grbl',
    );
  });
});

describe('toMarlinFanGcode edge behavior', () => {
  it('deduplicates consecutive power changes and passes comments through', () => {
    const out = toMarlinFanGcode(
      ['; comment', 'M4 S0', 'G1 X1 S100', 'G1 X2 S100', 'G1 X3 S200', 'M5'].join('\n'),
      1000,
    );
    expect(out.split('\n')).toEqual([
      '; comment',
      'M107',
      'M106 S26', // 100/1000 → 25.5 → 26
      'G1 X1',
      'G1 X2',
      'M106 S51',
      'G1 X3',
      'M107',
    ]);
  });
});
