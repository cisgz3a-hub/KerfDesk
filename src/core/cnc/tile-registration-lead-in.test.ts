// N7-P1-1 (CNC audit v3 verification): with the default arc lead-in, an
// Outside profile compiles to one open path (lead in, ring, lead out), and the
// N4-P1-1 placement did not see the part inside it: 11 of 14 bores went
// through a 600 x 300 panel, 5 of 8 through a disc, one into a coaster. These
// compile with the default lead and read the written tile programs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { Job } from '../job';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_TILING, type CncLayerSettings, type CncTiling } from '../scene';
import { tileJobs, type TiledJob } from './tile-plan';
import { TILE_REGISTRATION_LAYER_ID } from './tile-registration-placement';
import { distanceToRectOutline, isVertical, readProgram } from './tile-gcode-reader.test-support';
import {
  BIT_MM,
  REGISTRATION,
  circleOutline,
  compiledOutlines,
  compiledRectangle,
  contains,
  grow,
  jobBounds,
  machineWithStock,
  type Rect,
} from './tile-seam-fixtures.test-support';

const HOLE_RADIUS_MM = REGISTRATION.holeDiameterMm / 2;
const CUTTER_RADIUS_MM = BIT_MM / 2;
// A bore clear of an outside cut sits at least this far outside the part edge.
const PART_CLEARANCE_MM = 2 * CUTTER_RADIUS_MM + HOLE_RADIUS_MM;

type Point = { readonly x: number; readonly y: number };

// The default lead-in: no profileLead override.
const OUTSIDE: Partial<CncLayerSettings> = {
  cutType: 'profile-outside',
  depthMm: 12,
  depthPerPassMm: 4,
};

function tiled(job: Job, stock: Rect, tiling: Partial<CncTiling>) {
  const result = tileJobs(
    job,
    { ...DEFAULT_CNC_TILING, registration: REGISTRATION, ...tiling },
    { machine: machineWithStock(stock), device: DEFAULT_DEVICE_PROFILE },
  );
  if (result.kind !== 'ready') throw new Error(result.kind);
  return result;
}

function boresIn({ tile, job }: TiledJob): ReadonlyArray<Point> {
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
  const seen = new Map<string, Point>();
  for (const move of readProgram(gcode, { x: tile.rect.minX, y: tile.rect.minY })) {
    if (move.layerId !== TILE_REGISTRATION_LAYER_ID || move.motion !== 'G1') continue;
    if (!isVertical(move) || !(move.to.z < 0)) continue;
    seen.set(`${move.to.x.toFixed(2)},${move.to.y.toFixed(2)}`, { x: move.to.x, y: move.to.y });
  }
  return [...seen.values()];
}

function machineCentre(x: number, y: number): Point {
  return toMachineCoords({ x, y }, DEFAULT_DEVICE_PROFILE);
}

describe('registration bores miss parts cut with the default lead-in (N7-P1-1)', () => {
  it.each([false, true])('keeps every bore out of a 600 x 300 panel (tabs %s)', (tabsEnabled) => {
    const job = compiledRectangle({ w: 600, h: 300 }, { ...OUTSIDE, tabsEnabled });
    // The default lead makes the outline one open path, not a closed one.
    expect(
      job.groups.every(
        (group) => group.kind !== 'cnc' || group.passes.every((pass) => !pass.closed),
      ),
    ).toBe(true);
    const cutterLine = jobBounds(
      compiledRectangle({ w: 600, h: 300 }, { ...OUTSIDE, profileLead: { shape: 'none' } }),
    );
    const stock = grow(cutterLine, 15);
    const result = tiled(job, stock, { tileWidthMm: 250, tileHeightMm: 200 });
    const bores = result.tiles.flatMap(boresIn);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) {
      expect(contains(cutterLine, bore)).toBe(false);
      expect(distanceToRectOutline(bore, cutterLine)).toBeGreaterThanOrEqual(
        CUTTER_RADIUS_MM + HOLE_RADIUS_MM,
      );
      expect(contains(grow(stock, -HOLE_RADIUS_MM), bore)).toBe(true);
    }
  });

  it('keeps every bore out of a Ø320 disc', () => {
    const job = compiledOutlines([circleOutline(200, 200, 320)], OUTSIDE);
    const centre = machineCentre(200, 200);
    const stock = grow(jobBounds(job), 15);
    const result = tiled(job, stock, { tileWidthMm: 250, tileHeightMm: 250 });
    const bores = result.tiles.flatMap(boresIn);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) {
      expect(Math.hypot(bore.x - centre.x, bore.y - centre.y)).toBeGreaterThanOrEqual(
        160 + PART_CLEARANCE_MM - 0.05,
      );
    }
  });

  it('keeps every bore out of eight Ø90 coasters', () => {
    const centres = [0, 1, 2, 3].flatMap((col) =>
      [0, 1].map((row) => ({ x: 70 + col * 100, y: 70 + row * 100 })),
    );
    const job = compiledOutlines(
      centres.map(({ x, y }) => circleOutline(x, y, 90)),
      { ...OUTSIDE, depthMm: 6, depthPerPassMm: 2 },
    );
    const stock = grow(jobBounds(job), 10);
    const result = tiled(job, stock, { tileWidthMm: 250, tileHeightMm: 380 });
    const bores = result.tiles.flatMap(boresIn);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) {
      for (const { x, y } of centres) {
        const centre = machineCentre(x, y);
        expect(Math.hypot(bore.x - centre.x, bore.y - centre.y)).toBeGreaterThanOrEqual(
          45 + PART_CLEARANCE_MM - 0.05,
        );
      }
    }
  });

  it('lists the bores without claiming more than the placement checks', () => {
    const job = compiledRectangle({ w: 600, h: 300 }, OUTSIDE);
    const result = tiled(job, grow(jobBounds(job), 25), { tileWidthMm: 250, tileHeightMm: 200 });
    const advisories = result.advisories ?? [];
    expect(advisories.some((line) => line.includes('clear of every part'))).toBe(false);
    const listing = advisories.find((line) => line.startsWith('Registration holes'));
    if (listing !== undefined) {
      expect(listing).toContain('outside every outline the toolpaths go round');
      expect(listing).toContain('open outline is not known as a part');
    }
  });
});
