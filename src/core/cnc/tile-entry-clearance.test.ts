import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, CncPass } from '../job';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import { tileJobs } from './tile-plan';

// A preceding tool centre outside the tile can clear stock inside it with
// the edge of its cutter. Clipping drops that pass, invalidating its air floor.
describe('tile entry clearance after clipping', () => {
  it.each(['contour', 'path3d'] as const)(
    'drops whole-job cleared-air evidence on %s fragments',
    (kind) => {
      const points = [
        { x: 99.8, y: 20, z: -2 },
        { x: 100.2, y: 20, z: -2 },
      ];
      const target: CncPass =
        kind === 'contour'
          ? { kind, zMm: -2, polyline: points, closed: false, airFloorZMm: -1, entryPlunge: true }
          : {
              kind,
              points,
              closed: false,
              airFloorZMm: -1,
              entryRamp: true,
              lateralFeed: 'z-rate-capped',
            };
      const group: CncGroup = {
        kind: 'cnc',
        layerId: 'entry',
        color: '#ff0000',
        cutType: 'engrave',
        toolDiameterMm: 3.175,
        feedMmPerMin: 1000,
        plungeMmPerMin: 50,
        spindleRpm: 12000,
        spindleSpinupSec: 0,
        safeZMm: 3.81,
        rampEntryDeg: 5,
        passes: [
          {
            kind: 'contour',
            closed: false,
            zMm: 0,
            polyline: [
              { x: 0, y: 0 },
              { x: 200, y: 0 },
            ],
          },
          {
            kind: 'contour',
            closed: false,
            zMm: -1,
            polyline: [
              { x: 100.5, y: 20 },
              { x: 101, y: 20 },
            ],
          },
          target,
        ],
      };
      const tiled = tileJobs(
        { groups: [group] },
        { tileWidthMm: 100, tileHeightMm: 100, overlapMm: 0, registrationHoles: false },
      );
      if (tiled.kind !== 'ready') throw new Error('Expected tiles');
      const first = tiled.tiles[0]!.job;
      const cut = first.groups[0];
      if (cut?.kind !== 'cnc') throw new Error('Expected CNC group');
      expect(cut.passes).toHaveLength(2);
      const fragment = cut.passes[1]!;
      const gcode = cncGrblStrategy.emit(first, DEFAULT_DEVICE_PROFILE);
      expect(gcode).not.toMatch(/G0 Z-/);
      expect(fragment).not.toHaveProperty('airFloorZMm');
      expect(fragment).toMatchObject(
        kind === 'contour'
          ? { entryPlunge: true }
          : { entryRamp: true, lateralFeed: 'z-rate-capped' },
      );
      expect(gcode).toContain('G1 Z-2.000 F50');
    },
  );
});
