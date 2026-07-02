// H.10 tiling: grid planning, boundary clipping (with Z interpolation),
// per-tile translation to the machine origin, shared registration holes,
// and indexed file names.

import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import type { CncTiling } from '../scene';
import { planTiles, REGISTRATION_HOLE_DEPTH_MM, tileFileName, tileJobs } from './tile-plan';

const TILING: CncTiling = {
  tileWidthMm: 100,
  tileHeightMm: 100,
  overlapMm: 10,
  registrationHoles: false,
};

function groupOf(passes: CncGroup['passes']): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

function lineJob(x0: number, x1: number, y: number, zMm = -2): Job {
  return {
    groups: [
      groupOf([
        {
          kind: 'contour',
          zMm,
          closed: false,
          polyline: [
            { x: x0, y },
            { x: x1, y },
          ],
        },
      ]),
    ],
  };
}

describe('planTiles', () => {
  it('covers the bounds with an indexed grid stepped by tile-minus-overlap', () => {
    const tiles = planTiles({ minX: 0, minY: 0, maxX: 250, maxY: 80 }, TILING);
    // Width 250 at 90 mm steps → 3 columns; height 80 fits one row.
    expect(tiles).toHaveLength(3);
    expect(tiles.map((tile) => `${tile.row},${tile.col}`)).toEqual(['0,0', '0,1', '0,2']);
    expect(tiles[1]?.rect.minX).toBe(90);
    expect(tiles[1]?.rect.maxX).toBe(190);
  });

  it('a job smaller than one tile plans a single tile', () => {
    expect(planTiles({ minX: 0, minY: 0, maxX: 50, maxY: 50 }, TILING)).toHaveLength(1);
  });
});

describe('tileJobs clipping', () => {
  it('splits a long line across tiles, translated to each tile origin', () => {
    const tiled = tileJobs(lineJob(0, 250, 40), TILING);
    expect(tiled).toHaveLength(3);
    for (const { tile, job } of tiled) {
      const group = job.groups[0];
      if (group?.kind !== 'cnc') throw new Error('cnc group missing');
      const pass = group.passes[0];
      if (pass?.kind !== 'contour') throw new Error('contour missing');
      // Translated into tile-local coordinates: within [0, tileWidth].
      for (const point of pass.polyline) {
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.x).toBeLessThanOrEqual(TILING.tileWidthMm + 1e-9);
      }
      // The stock-space span of this piece matches the tile rect ∩ line.
      const spanStart = (pass.polyline[0]?.x ?? 0) + tile.rect.minX;
      const spanEnd = (pass.polyline.at(-1)?.x ?? 0) + tile.rect.minX;
      expect(spanStart).toBeCloseTo(Math.max(0, tile.rect.minX), 6);
      expect(spanEnd).toBeCloseTo(Math.min(250, tile.rect.maxX), 6);
    }
  });

  it('clips closed loops into open pieces including the seam segment', () => {
    // The wide line stretches the job bounds to 0..250 so the col-0/col-1
    // seam (x = 90..100) crosses the square at 80..120.
    const passes: CncGroup['passes'] = [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: [
          { x: 0, y: 5 },
          { x: 250, y: 5 },
        ],
      },
      {
        kind: 'contour',
        zMm: -1,
        closed: true,
        polyline: [
          { x: 80, y: 20 },
          { x: 120, y: 20 },
          { x: 120, y: 60 },
          { x: 80, y: 60 },
        ],
      },
    ];
    const tiled = tileJobs({ groups: [groupOf(passes)] }, TILING);
    expect(tiled.length).toBeGreaterThanOrEqual(2);
    // Both of the first two tiles carry a piece of the (no longer closed)
    // square, and every clipped pass is open.
    let squarePieces = 0;
    for (const { job } of tiled) {
      for (const group of job.groups) {
        if (group.kind !== 'cnc') continue;
        for (const pass of group.passes) {
          expect(pass.closed).toBe(false);
          if (pass.kind === 'contour' && pass.polyline.some((p) => p.y > 10)) {
            squarePieces += 1;
          }
        }
      }
    }
    expect(squarePieces).toBeGreaterThanOrEqual(2);
  });

  it('lerps Z through the boundary for path3d passes', () => {
    const ramp: CncGroup['passes'] = [
      {
        kind: 'path3d',
        closed: false,
        points: [
          { x: 0, y: 40, z: 0 },
          { x: 200, y: 40, z: -4 },
        ],
      },
    ];
    const tiled = tileJobs({ groups: [groupOf(ramp)] }, TILING);
    const first = tiled[0]?.job.groups[0];
    if (first?.kind !== 'cnc') throw new Error('group missing');
    const pass = first.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('path3d missing');
    // Tile 0 covers x 0..100 → exit Z = -4 · (100/200) = -2.
    expect(pass.points.at(-1)?.z).toBeCloseTo(-2, 9);
  });

  it('drops tiles with no motion', () => {
    // Line only in the left half of a 2-column grid.
    const tiled = tileJobs(lineJob(0, 95, 150, -1), {
      ...TILING,
      tileHeightMm: 200,
    });
    expect(tiled).toHaveLength(1);
  });
});

describe('registration holes', () => {
  it('adjacent tiles drill the SAME stock positions inside the overlap strip', () => {
    const tiling: CncTiling = { ...TILING, registrationHoles: true };
    const tiled = tileJobs(lineJob(0, 190, 50, -1), tiling);
    expect(tiled).toHaveLength(2);
    const holesInStock = tiled.map(({ tile, job }) => {
      const drill = job.groups.find((group) => group.kind === 'cnc' && group.cutType === 'drill');
      if (drill?.kind !== 'cnc') throw new Error('registration group missing');
      return drill.passes.map((pass) => {
        if (pass.kind !== 'path3d') throw new Error('peck expected');
        const point = pass.points[0];
        if (point === undefined) throw new Error('peck point missing');
        expect(point.z).toBe(-REGISTRATION_HOLE_DEPTH_MM);
        return `${(point.x + tile.rect.minX).toFixed(3)},${(point.y + tile.rect.minY).toFixed(3)}`;
      });
    });
    // Same stock coordinates appear in both tiles' files.
    expect(new Set(holesInStock[0]).size).toBeGreaterThan(0);
    expect(holesInStock[0]).toEqual(holesInStock[1]);
  });
});

describe('tileFileName', () => {
  it('carries the 1-based row/col index', () => {
    expect(
      tileFileName('sign', { row: 1, col: 2, rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }),
    ).toBe('sign_tile-r2-c3');
  });
});
