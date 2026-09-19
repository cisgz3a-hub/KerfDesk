import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTiling } from '../scene';
import type { CncTileRegistration } from '../scene/machine';
import { planTiles, tileJobs } from './tile-plan';
import { maximumRegistrationHolesPerTile, registrationGroupForTile } from './tile-registration';
import * as registrationPasses from './tile-registration-passes';
import { resolveTileRegistration } from './tile-registration-plan';

const MAX_ARRAY_LENGTH = 0xffff_ffff;
const MACHINE = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [{ id: 'flat-2', name: '2 mm flat mill', kind: 'end-mill' as const, diameterMm: 2 }],
};
const SETTINGS: CncTileRegistration = {
  toolId: 'flat-2',
  holeDiameterMm: 2,
  depthMm: 1,
  depthPerPassMm: 1,
  feedMmPerMin: 500,
  plungeMmPerMin: 100,
  spindleRpm: 10000,
};
const TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: true,
  registration: SETTINGS,
};

describe('registration Array representation', () => {
  it('checks the full peck points array while keeping separate holes independent', () => {
    // 0, floor1, 0, floor2, ..., final floor: exactly 2D points per hole.
    const lastRepresentable = { ...SETTINGS, depthMm: Math.floor(MAX_ARRAY_LENGTH / 2) };
    expect(resolveTileRegistration(lastRepresentable, MACHINE, 8)).toHaveProperty('settings');
    expect(resolveTileRegistration({ ...SETTINGS, depthMm: 2 ** 31 }, MACHINE)).toContain(
      'Array length limit',
    );
  });

  it('checks depth times circle/centre passes even when each input count is representable', () => {
    // D=65536, R=65536: D*(R+1)=4,295,032,832 passes in one hole.
    const settings = { ...SETTINGS, depthMm: 65536, holeDiameterMm: 2 * (65536 + 1) };
    expect(resolveTileRegistration(settings, MACHINE)).toContain('Array length limit');
  });

  it('does not lower the actual pass-array limit', () => {
    // One depth, R=MAX-1 circles and one centre pass exactly fit the Array limit.
    const settings = { ...SETTINGS, holeDiameterMm: 2 * MAX_ARRAY_LENGTH };
    expect(resolveTileRegistration(settings, MACHINE)).toHaveProperty('settings');
    expect(
      resolveTileRegistration(
        { ...settings, holeDiameterMm: settings.holeDiameterMm + 2 },
        MACHINE,
      ),
    ).toContain('Array length limit');
  });

  it('checks the actual tile group before generating any of its individually representable holes', () => {
    // Each hole has 2^30 passes; a 2x2 grid has four holes per tile, totaling 2^32.
    const settings = { ...SETTINGS, depthMm: 32768, holeDiameterMm: 65536 };
    expect(resolveTileRegistration(settings, MACHINE)).toHaveProperty('settings');
    // A future regression must fail without attempting a billion-pass allocation.
    const generated = vi.spyOn(registrationPasses, 'tileRegistrationPasses').mockReturnValue([]);
    try {
      const result = tileJobs(
        diagonalJob(),
        { ...TILING, registration: settings },
        {
          machine: MACHINE,
          device: DEFAULT_DEVICE_PROFILE,
        },
      );
      expect(result).toMatchObject({
        kind: 'registration-invalid',
        message: expect.stringContaining('Array length limit'),
      });
      expect(generated).not.toHaveBeenCalled();
    } finally {
      generated.mockRestore();
    }
  });

  it.each([
    [1, 1, 0],
    [2, 1, 2],
    [3, 1, 4],
    [2, 2, 4],
    [3, 2, 6],
    [3, 3, 8],
  ])('counts actual seam holes for a %ix%i grid', (columns, rows, expected) => {
    const plan = planTiles(
      { minX: 0, minY: 0, maxX: 100 + 90 * (columns - 1), maxY: 100 + 90 * (rows - 1) },
      TILING,
    );
    if (plan.kind !== 'ready') throw new Error(plan.kind);
    const resolved = resolveTileRegistration(SETTINGS, MACHINE);
    if (typeof resolved === 'string') throw new Error(resolved);
    const actual = plan.tiles.map(
      (tile) =>
        registrationGroupForTile(tile, plan.grid, resolved, MACHINE, DEFAULT_DEVICE_PROFILE)?.passes
          .length ?? 0,
    );
    expect(Math.max(...actual)).toBe(expected);
    expect(maximumRegistrationHolesPerTile(plan.grid)).toBe(expected);
  });
});

function diagonalJob(): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'line',
        color: '#000000',
        cutType: 'engrave',
        toolDiameterMm: 2,
        feedMmPerMin: 500,
        plungeMmPerMin: 100,
        spindleRpm: 10000,
        spindleSpinupSec: 0,
        safeZMm: 3,
        passes: [
          {
            kind: 'contour',
            closed: false,
            zMm: -1,
            polyline: [
              { x: 0, y: 0 },
              { x: 190, y: 190 },
            ],
          },
        ],
      },
    ],
  };
}
