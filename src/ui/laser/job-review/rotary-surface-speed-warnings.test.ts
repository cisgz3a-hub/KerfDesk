import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { CutGroup, Job } from '../../../core/job';
import { detectRotarySurfaceSpeedWarnings } from './rotary-surface-speed-warnings';

const PLACEHOLDER_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 80,
  rollerDiameterMm: 25,
};

function job(speed: number, kind: 'cut' | 'raster' = 'cut'): Job {
  const cut: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed,
    passes: 1,
    airAssist: false,
    segments: [],
  };
  return { groups: kind === 'cut' ? [cut] : [] };
}

function project(rotary: RotarySetup | undefined) {
  return {
    device: {
      ...DEFAULT_DEVICE_PROFILE,
      maxFeed: 6000,
      ...(rotary === undefined ? {} : { rotary }),
    },
  };
}

describe('detectRotarySurfaceSpeedWarnings (ADR-127 Amd 2)', () => {
  it('warns when a k > 1 roller needs more Y feed than the Max feed', () => {
    // 360 / (π · 25) = 4.58 machine mm per surface mm.
    const [warning, ...rest] = detectRotarySurfaceSpeedWarnings(
      project(PLACEHOLDER_ROLLER),
      job(1500),
    );
    expect(rest).toEqual([]);
    expect(warning).toBe(
      'This rotary turns Y ×4.58, so a 1500 mm/min stroke round the part needs 6876 mm/min of ' +
        'Y feed, more than the Max feed (6000 mm/min). Strokes round the part run at 1308 ' +
        'mm/min on its surface and burn darker than strokes along it. For an even burn, set ' +
        'the vector layers to 1308 mm/min or less.',
    );
  });

  it('is silent when the feed fits, on a chuck that slows Y, flat, or with no vectors', () => {
    expect(detectRotarySurfaceSpeedWarnings(project(PLACEHOLDER_ROLLER), job(1200))).toEqual([]);
    const chuck: RotarySetup = {
      enabled: true,
      type: 'chuck',
      mmPerRotation: 40,
      objectDiameterMm: 80,
    };
    expect(detectRotarySurfaceSpeedWarnings(project(chuck), job(6000))).toEqual([]);
    expect(detectRotarySurfaceSpeedWarnings(project(undefined), job(6000))).toEqual([]);
    expect(
      detectRotarySurfaceSpeedWarnings(
        project({ ...PLACEHOLDER_ROLLER, enabled: false }),
        job(6000),
      ),
    ).toEqual([]);
    expect(
      detectRotarySurfaceSpeedWarnings(project(PLACEHOLDER_ROLLER), job(6000, 'raster')),
    ).toEqual([]);
  });
});
