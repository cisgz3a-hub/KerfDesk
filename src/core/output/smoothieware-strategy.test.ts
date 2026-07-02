import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { findLaserOnTravelIssues } from '../invariants';
import type { Job } from '../job';
import { smoothiewareStrategy } from './smoothieware-strategy';
import { selectOutputStrategy } from './select-output-strategy';

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
          ],
          closed: false,
        },
      ],
    },
  ],
};

const SMOOTHIE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

describe('smoothiewareStrategy', () => {
  it('emits fractional S at the 0-1.0 Smoothie scale (non-negotiable #7)', () => {
    const out = smoothiewareStrategy.emit(JOB, SMOOTHIE_DEVICE);
    expect(out).toContain('S0.500'); // 50% of max 1.0
    expect(out).not.toMatch(/\bS500\b/); // the integer-scale word must be gone
    expect(out).toContain('M3 S0'); // arm line keeps S0
  });

  it('keeps travel laser-off (non-negotiable #3) at fractional scale', () => {
    const out = smoothiewareStrategy.emit(JOB, SMOOTHIE_DEVICE);
    expect(findLaserOnTravelIssues(out)).toEqual([]);
  });

  it('scales to integer S when the profile max is large', () => {
    const out = smoothiewareStrategy.emit(JOB, { ...SMOOTHIE_DEVICE, maxPowerS: 100 });
    expect(out).toContain('S50');
  });

  it('is deterministic (non-negotiable #5)', () => {
    expect(smoothiewareStrategy.emit(JOB, SMOOTHIE_DEVICE)).toBe(
      smoothiewareStrategy.emit(JOB, SMOOTHIE_DEVICE),
    );
  });

  it('is selected for smoothieware profiles', () => {
    expect(selectOutputStrategy(SMOOTHIE_DEVICE).id).toBe('smoothieware');
  });
});
