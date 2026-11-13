// N4-P2-1 (CNC audit v3; P2-advcam-1 of the 2026-09-29 audit): a piece a tile
// edge cut out of a toolpath started with a straight plunge. A helical
// pocket's helix ran at the cutting feed, a profile's lead-in became a plunge
// on the cutter line at every level, and the only notice called any ramp a
// V-carve ramp. These read the written tile programs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from '../job';
import { cncGrblStrategy } from '../output';
import type { CncTiling } from '../scene';
import { tileJobs } from './tile-plan';
import {
  distanceToRectOutline,
  isVertical,
  plungesIntoStock,
  readProgram,
  type Move,
} from './tile-gcode-reader.test-support';
import { LAYER_ID, compiledRectangle, jobBounds } from './tile-seam-fixtures.test-support';

const PLUNGE_FEED = 300;

function tileMoves(job: Job, tiling: CncTiling): ReadonlyArray<ReadonlyArray<Move>> {
  const result = tileJobs(job, tiling);
  if (result.kind !== 'ready') throw new Error(result.kind);
  expect(result.tiles.length).toBeGreaterThan(1);
  return result.tiles.map(({ tile, job: tileJob }) =>
    readProgram(cncGrblStrategy.emit(tileJob, DEFAULT_DEVICE_PROFILE), {
      x: tile.rect.minX,
      y: tile.rect.minY,
    }),
  );
}

function untiledMoves(job: Job): ReadonlyArray<Move> {
  return readProgram(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
}

// One seam, no overlap, through the given X.
function seamAt(job: Job, x: number): CncTiling {
  const bounds = jobBounds(job);
  return {
    tileWidthMm: x - bounds.minX,
    tileHeightMm: 380,
    overlapMm: 0,
    registrationHoles: false,
  };
}

describe('pieces a tile edge starts keep their operation’s entry (N4-P2-1)', () => {
  it('enters a helical pocket cut by a seam through its helix without plunging into stock', () => {
    const job = compiledRectangle(
      { w: 160, h: 80 },
      {
        cutType: 'pocket',
        depthMm: 4,
        depthPerPassMm: 2,
        helixEntry: { maxDiameterMm: 6, minDiameterMm: 1, angleDeg: 3 },
      },
    );
    const group = job.groups[0];
    const helix =
      group?.kind === 'cnc' ? group.passes.find((pass) => pass.kind === 'helical-contour') : null;
    if (helix?.kind !== 'helical-contour') throw new Error('expected a helical entry');
    expect(plungesIntoStock(untiledMoves(job), LAYER_ID)).toEqual([]);

    for (const moves of tileMoves(job, seamAt(job, helix.center.x))) {
      expect(plungesIntoStock(moves, LAYER_ID)).toEqual([]);
      // The helix descends at the plunge feed; so does every stand-in for it.
      const descents = moves.filter(
        (move) =>
          move.layerId === LAYER_ID &&
          move.motion !== 'G0' &&
          !isVertical(move) &&
          move.to.z < move.from.z - 1e-9,
      );
      expect(descents.length).toBeGreaterThan(0);
      for (const move of descents) expect(move.feed).toBeLessThanOrEqual(PLUNGE_FEED);
    }
  });

  it('never plunges a lead-in profile into stock on its cutter line at a seam', () => {
    const settings = { cutType: 'profile-outside' as const, depthMm: 6, depthPerPassMm: 2 };
    const job = compiledRectangle({ w: 100, h: 100 }, settings);
    const cutterLine = jobBounds(
      compiledRectangle({ w: 100, h: 100 }, { ...settings, profileLead: { shape: 'none' } }),
    );
    const onLine = (point: { readonly x: number; readonly y: number }) =>
      distanceToRectOutline(point, cutterLine) < 0.01;
    // Untiled, each level plunges at its lead's start, off the cutter line.
    const untiled = plungesIntoStock(untiledMoves(job), LAYER_ID);
    expect(untiled.length).toBeGreaterThan(0);
    expect(untiled.filter(onLine)).toEqual([]);

    const midX = (cutterLine.minX + cutterLine.maxX) / 2;
    for (const moves of tileMoves(job, { ...seamAt(job, midX + 10), overlapMm: 20 })) {
      expect(plungesIntoStock(moves, LAYER_ID).filter(onLine)).toEqual([]);
    }
  });

  it('names the operation, not V-carve, when a ramped profile crosses a seam', () => {
    const job = compiledRectangle(
      { w: 100, h: 100 },
      {
        cutType: 'profile-outside',
        depthMm: 6,
        depthPerPassMm: 2,
        rampEntryDeg: 5,
        profileLead: { shape: 'none' },
      },
    );
    const bounds = jobBounds(job);
    const result = tileJobs(job, seamAt(job, (bounds.minX + bounds.maxX) / 2));
    if (result.kind !== 'ready') throw new Error(result.kind);
    const advisories = result.advisories ?? [];
    expect(advisories.some((line) => line.includes('V-carve'))).toBe(false);
    expect(advisories).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Tiled Outside profile ramp entries'),
        expect.stringContaining('pieces of Outside profile (ramp entry)'),
      ]),
    );
  });
});
