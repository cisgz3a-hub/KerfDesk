import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { CutGroup, Job } from '../../../core/job';
import type { Vec2 } from '../../../core/scene';
import { detectRotarySurfaceSpeedWarnings } from './rotary-surface-speed-warnings';

// ADR-127 Amendment 2 D4, rolling audit v13 Y5-P2-1 / Y5-P3-1: Job Review
// warns from the job's own moves wherever the Max feed holds a stroke round the
// part back, taper and k <= 1 rollers included, and never for strokes along X.

const PLACEHOLDER_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 80,
  rollerDiameterMm: 25,
};

// A 20 oz-style tumbler (Ø88 at the rim, Ø72 at the base over 150 mm) on a
// roller with no roller diameter: k is exactly 1.
const TAPERED_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 360,
  objectDiameterMm: 88,
  taper: {
    enabled: true,
    topDiameterMm: 88,
    bottomDiameterMm: 72,
    lengthMm: 150,
    topSide: 'left',
    artworkFromTopMm: 0,
  },
};

function job(speed: number, strokes: ReadonlyArray<readonly [Vec2, Vec2]>): Job {
  const cut: CutGroup = {
    kind: 'cut',
    layerId: 'L1',
    color: '#ff0000',
    power: 50,
    speed,
    passes: 1,
    airAssist: false,
    segments: strokes.map(([from, to]) => ({ polyline: [from, to], closed: false })),
  };
  return { groups: [cut] };
}

const ROUND = (x: number): readonly [Vec2, Vec2] => [
  { x, y: 20 },
  { x, y: 40 },
];
const ALONG: readonly [Vec2, Vec2] = [
  { x: 10, y: 30 },
  { x: 60, y: 30 },
];

function project(rotary: RotarySetup | undefined) {
  return {
    device: {
      ...DEFAULT_DEVICE_PROFILE,
      maxFeed: 6000,
      ...(rotary === undefined ? {} : { rotary }),
    },
    scene: { layers: [{ id: 'L1', name: 'Name' }] as never },
  };
}

describe('detectRotarySurfaceSpeedWarnings (ADR-127 Amd 2)', () => {
  it('warns when a k > 1 roller needs more feed round the part than the Max feed', () => {
    // 360 / (π · 25) = 4.58: a 1500 mm/min stroke round the part needs 6876.
    expect(
      detectRotarySurfaceSpeedWarnings(project(PLACEHOLDER_ROLLER), job(1500, [ROUND(10)])),
    ).toEqual([
      'Layer Name: on this rotary its strokes round the part need more feed than the Max feed ' +
        '(6000 mm/min), so they are held there and run slower on the part. They burn up to ' +
        '115 % of the energy you set. For an even burn, set this layer to 1308 mm/min or less.',
    ]);
  });

  it('warns at the narrow end of a taper on a k = 1 roller (Y5-P2-1)', () => {
    const [warning, ...rest] = detectRotarySurfaceSpeedWarnings(
      project(TAPERED_ROLLER),
      job(6000, [ROUND(0), ROUND(150)]),
    );
    expect(rest).toEqual([]);
    // Ø88 / Ø72 = 1.222: the base needs 22 % more feed than 6000.
    expect(warning).toContain('most at the narrow end of the taper');
    expect(warning).toContain('They burn up to 122 % of the energy you set');
    expect(warning).toContain('set this layer to 4909 mm/min or less');
  });

  it('is silent at the Max feed for rows along a taper that the warp leans by a hair (Z3-P3-2)', () => {
    // Rows far from the warp's pivot lean a little; at 6000 they round to 100 %.
    const rows = [10, 30, 50, 70].map(
      (y) =>
        [
          { x: 0, y },
          { x: 150, y },
        ] as const,
    );
    expect(detectRotarySurfaceSpeedWarnings(project(TAPERED_ROLLER), job(6000, rows))).toEqual([]);
  });

  it('is silent for strokes along X, under the Max feed, on a chuck, or flat (Y5-P3-1)', () => {
    expect(
      detectRotarySurfaceSpeedWarnings(project(PLACEHOLDER_ROLLER), job(6000, [ALONG])),
    ).toEqual([]);
    expect(
      detectRotarySurfaceSpeedWarnings(project(PLACEHOLDER_ROLLER), job(1200, [ROUND(10)])),
    ).toEqual([]);
    expect(
      detectRotarySurfaceSpeedWarnings(project(TAPERED_ROLLER), job(4900, [ROUND(150)])),
    ).toEqual([]);
    const chuck: RotarySetup = {
      enabled: true,
      type: 'chuck',
      mmPerRotation: 40,
      objectDiameterMm: 80,
    };
    expect(detectRotarySurfaceSpeedWarnings(project(chuck), job(6000, [ROUND(10)]))).toEqual([]);
    expect(detectRotarySurfaceSpeedWarnings(project(undefined), job(6000, [ROUND(10)]))).toEqual(
      [],
    );
    expect(
      detectRotarySurfaceSpeedWarnings(
        project({ ...PLACEHOLDER_ROLLER, enabled: false }),
        job(6000, [ROUND(10)]),
      ),
    ).toEqual([]);
  });
});
