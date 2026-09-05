import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup } from '../job';
import { cncGrblStrategy } from './cnc-grbl-strategy';

function group(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'feed-boundary',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
        ],
        closed: false,
      },
    ],
    ...overrides,
  };
}

describe('CNC GRBL feed representation', () => {
  it('floors decimal cut and plunge feeds without exceeding their ceilings', () => {
    const gcode = cncGrblStrategy.emit(
      { groups: [group({ feedMmPerMin: 1000.6, plungeMmPerMin: 300.9 })] },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G1 Z-1.000 F300');
    expect(gcode).toContain('G1 X20.000 Y10.000 F1000');
    expect(gcode).not.toMatch(/\bF1001\b|\bF301\b/);
  });

  it('writes a tiny z-rate feed as decimal G-code rather than exponent syntax', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group({
            feedMmPerMin: 1e-7,
            plungeMmPerMin: 1e-7,
            passes: [zRatePass()],
          }),
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, maxFeed: 1e-7 },
    );

    expect(gcode).toContain('F0.0000001');
    expect(gcode).not.toMatch(/F\S*[eE][+-]?\d+/);
  });

  it('keeps a z-rate-capped segment within a fractional plunge ceiling', () => {
    const plungeMmPerMin = 0.1;
    const gcode = cncGrblStrategy.emit(
      {
        groups: [group({ feedMmPerMin: 1000, plungeMmPerMin, passes: [zRatePass()] })],
      },
      DEFAULT_DEVICE_PROFILE,
    );
    const segmentLine = gcode.split('\n').find((line) => line.includes('X0.100Y0.000Z-1.000'));
    const representedFeed = Number(segmentLine?.match(/F([0-9.]+)/)?.[1]);
    const zComponent = representedFeed / Math.hypot(0.1, 1);

    expect(segmentLine).toBeDefined();
    expect(Number.isFinite(representedFeed)).toBe(true);
    expect(zComponent).toBeLessThanOrEqual(plungeMmPerMin);
  });
});

function zRatePass(): CncGroup['passes'][number] {
  return {
    kind: 'path3d',
    points: [
      { x: 0, y: 0, z: 0 },
      { x: 0.1, y: 0, z: -1 },
    ],
    closed: false,
    lateralFeed: 'z-rate-capped',
  };
}
