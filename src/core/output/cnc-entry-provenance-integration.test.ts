import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../cnc/compile-cnc-job';
import { isSendableGcodeLine } from '../controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass } from '../job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type Scene,
} from '../scene';
import { cncGrblStrategy } from './cnc-grbl-strategy';

function compile(settings: Partial<CncLayerSettings>): string {
  const scene: Scene = {
    objects: [
      {
        kind: 'imported-svg',
        id: 'square',
        source: 'square.svg',
        bounds: { minX: 20, minY: 20, maxX: 50, maxY: 50 },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color: '#ff0000',
            polylines: [
              {
                closed: true,
                points: [
                  { x: 20, y: 20 },
                  { x: 50, y: 20 },
                  { x: 50, y: 50 },
                  { x: 20, y: 50 },
                ],
              },
            ],
          },
        ],
      },
    ],
    layers: [
      {
        ...createLayer({ id: 'cut', color: '#ff0000' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          tabsEnabled: false,
          depthMm: 1,
          depthPerPassMm: 1,
          ...settings,
        },
      },
    ],
  };
  return cncGrblStrategy.emit(
    compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG),
    DEFAULT_DEVICE_PROFILE,
  );
}

function emit(passes: ReadonlyArray<CncPass>, overrides: Partial<CncGroup> = {}): string {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'cut',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 50,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3.81,
    rampEntryDeg: 5,
    passes,
    ...overrides,
  };
  return cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
}

describe('entry provenance follows compiled paths', () => {
  it.each([
    { cutType: 'drill' as const },
    { cutType: 'pocket' as const, pocketStrategy: 'adaptive' as const, depthMm: 3 },
  ])(
    'does not claim a retained contour ramp for $cutType/$pocketStrategy',
    (settings) => {
      const requested = compile({ ...settings, rampEntryDeg: 5 });
      const without = compile(settings);
      expect(requested.split('\n').filter(isSendableGcodeLine)).toEqual(
        without.split('\n').filter(isSendableGcodeLine),
      );
      expect(requested).toContain('; cnc entry: requested-only; requested-max-angle-deg: 5.000');
      expect(requested).toContain('requested contour ramp is not applied to these passes');
      expect(requested).not.toContain('; cnc entry: contour-ramp;');
    },
    30_000,
  );

  it('does not call a normal later-depth ramp a clipped tile plunge', () => {
    const program = emit([
      {
        kind: 'path3d',
        closed: false,
        entryRamp: true,
        lateralFeed: 'z-rate-capped',
        points: [
          { x: 10, y: 10, z: -1 },
          { x: 30, y: 10, z: -2 },
        ],
      },
    ]);
    expect(program).toContain('; cnc entry: contour-ramp; requested-max-angle-deg: 5.000');
    expect(program).not.toContain('tiled ramp starts below stock top');
  });

  it.each(['contour', 'path3d'] as const)(
    'discloses coordinate-precision fallback on %s without a short-path claim',
    (kind) => {
      const pass: CncPass =
        kind === 'contour'
          ? {
              kind,
              closed: false,
              zMm: -1,
              entryPlunge: true,
              entryPlungeReason: 'coordinate-precision',
              polyline: [
                { x: 10, y: 10 },
                { x: 20, y: 10 },
              ],
            }
          : {
              kind,
              closed: false,
              entryPlunge: true,
              entryPlungeReason: 'coordinate-precision',
              points: [
                { x: 10, y: 10, z: -1 },
                { x: 20, y: 10, z: -1 },
              ],
            };
      const program = emit([pass]);
      expect(program).toContain(
        '1 pass plunges: ramp angle cannot descend at coordinate precision',
      );
      expect(program).not.toContain('path shorter than one cut width');
      expect(program).not.toContain('; cnc entry: contour-ramp;');
    },
  );
});
