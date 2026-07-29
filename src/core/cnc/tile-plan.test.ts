// H.10 tiling: grid planning, boundary clipping (with Z interpolation),
// per-tile translation to the machine origin, shared registration holes,
// and indexed file names.

import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import type { CncTiling } from '../scene';
import { tileFileName, tileJobs, type TiledJob } from './tile-plan';

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

function readyTiledJobs(job: Job, tiling: CncTiling = TILING): ReadonlyArray<TiledJob> {
  const result = tileJobs(job, tiling);
  if (result.kind !== 'ready') throw new Error('expected materialized tile jobs');
  return result.tiles;
}

describe('tileJobs clipping', () => {
  it('splits a long line across tiles, translated to each tile origin', () => {
    const tiled = readyTiledJobs(lineJob(0, 250, 40));
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
    const tiled = readyTiledJobs({ groups: [groupOf(passes)] });
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
    const tiled = readyTiledJobs({ groups: [groupOf(ramp)] });
    const first = tiled[0]?.job.groups[0];
    if (first?.kind !== 'cnc') throw new Error('group missing');
    const pass = first.passes[0];
    if (pass?.kind !== 'path3d') throw new Error('path3d missing');
    // Tile 0 covers x 0..100 → exit Z = -4 · (100/200) = -2.
    expect(pass.points.at(-1)?.z).toBeCloseTo(-2, 9);
  });

  it('clips arc passes as sampled contour pieces per tile', () => {
    const arc: CncGroup['passes'] = [
      {
        kind: 'arc',
        start: { x: 50, y: 0 },
        end: { x: 250, y: 0 },
        center: { x: 150, y: 0 },
        clockwise: false,
        zMm: -1.5,
        closed: false,
      },
    ];
    const tiled = readyTiledJobs({ groups: [groupOf(arc)] });
    expect(tiled.length).toBeGreaterThan(1);
    for (const { job } of tiled) {
      const group = job.groups[0];
      if (group?.kind !== 'cnc') throw new Error('group missing');
      for (const pass of group.passes) {
        if (pass.kind !== 'contour') throw new Error('arc should tile as contour fallback');
        expect(pass.zMm).toBe(-1.5);
        expect(pass.closed).toBe(false);
        for (const point of pass.polyline) {
          expect(point.x).toBeGreaterThanOrEqual(-1e-9);
          expect(point.x).toBeLessThanOrEqual(TILING.tileWidthMm + 1e-9);
        }
      }
    }
  });

  it('clips helical passes into tile-safe XYZ motion with interpolated depth', () => {
    const helix: CncGroup['passes'] = [
      {
        kind: 'helical-contour',
        start: { x: 95, y: 50 },
        center: { x: 90, y: 50 },
        clockwise: false,
        startZMm: 0,
        zMm: -2,
        revolutions: 2,
        polyline: [
          { x: 95, y: 50 },
          { x: 250, y: 50 },
        ],
        closed: false,
      },
    ];
    const tiled = readyTiledJobs({ groups: [groupOf(helix)] });
    expect(tiled.length).toBeGreaterThan(1);
    const points = tiled.flatMap(({ job }) =>
      job.groups.flatMap((group) =>
        group.kind === 'cnc'
          ? group.passes.flatMap((pass) => (pass.kind === 'path3d' ? pass.points : []))
          : [],
      ),
    );
    expect(points.length).toBeGreaterThan(4);
    expect(points.some((point) => point.z < 0 && point.z > -2)).toBe(true);
    expect(points.some((point) => point.z === -2)).toBe(true);
  });

  it('drops tiles with no motion', () => {
    // Line only in the left half of a 2-column grid.
    const tiled = readyTiledJobs(lineJob(0, 95, 150, -1), {
      ...TILING,
      tileHeightMm: 200,
    });
    expect(tiled).toHaveLength(1);
  });
});

describe('tileFileName', () => {
  it('carries the 1-based row/col index', () => {
    expect(
      tileFileName('sign', { row: 1, col: 2, rect: { minX: 0, minY: 0, maxX: 1, maxY: 1 } }),
    ).toBe('sign_tile-r2-c3');
  });
});
