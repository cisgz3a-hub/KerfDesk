// N4-P1-1 (CNC audit v3; AC-5 of the 2026-09-24 audit): tile registration
// bores went at fixed 1/4 and 3/4 points of every seam, through the parts and
// off the board, with no warning. These read the written tile programs.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output';
import { DEFAULT_CNC_TILING, type CncMachineConfig, type CncTiling } from '../scene';
import type { Job } from '../job';
import { plannedTileRegistration, tileJobs, type TiledJob } from './tile-plan';
import { TILE_REGISTRATION_LAYER_ID } from './tile-registration-placement';
import { distanceToRectOutline, isVertical, readProgram } from './tile-gcode-reader.test-support';
import {
  BIT_MM,
  REGISTRATION,
  compiledRectangle,
  compiledRectangles,
  contains,
  grow,
  jobBounds,
  machineWithStock,
  type Rect,
} from './tile-seam-fixtures.test-support';

const HOLE_RADIUS_MM = REGISTRATION.holeDiameterMm / 2;
const CUTTER_RADIUS_MM = BIT_MM / 2;

type Bore = { readonly x: number; readonly y: number };

function through(size: { readonly w: number; readonly h: number }, depthMm = 6): Job {
  return compiledRectangle(size, {
    cutType: 'profile-outside',
    depthMm,
    depthPerPassMm: 2,
    profileLead: { shape: 'none' },
  });
}

function tiled(job: Job, machine: CncMachineConfig, tiling: CncTiling) {
  const result = tileJobs(job, tiling, { machine, device: DEFAULT_DEVICE_PROFILE });
  if (result.kind !== 'ready') throw new Error(result.kind);
  return result;
}

// Every bore a tile program drills, read back from its G-code, in stock mm.
function boresIn({ tile, job }: TiledJob): ReadonlyArray<Bore> {
  const gcode = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
  const origin = { x: tile.rect.minX, y: tile.rect.minY };
  const seen = new Map<string, Bore>();
  for (const move of readProgram(gcode, origin)) {
    if (move.layerId !== TILE_REGISTRATION_LAYER_ID || move.motion !== 'G1') continue;
    if (!isVertical(move) || !(move.to.z < 0)) continue;
    seen.set(`${move.to.x.toFixed(2)},${move.to.y.toFixed(2)}`, { x: move.to.x, y: move.to.y });
  }
  return [...seen.values()];
}

function expectClear(bore: Bore, cutterLine: Rect, stock: Rect): void {
  // Not in the part (inside the outline's cutter line) ...
  expect(contains(cutterLine, bore)).toBe(false);
  // ... nor in the outline's cut ...
  expect(distanceToRectOutline(bore, cutterLine)).toBeGreaterThanOrEqual(
    CUTTER_RADIUS_MM + HOLE_RADIUS_MM,
  );
  // ... and wholly on the board.
  expect(contains(grow(stock, -HOLE_RADIUS_MM), bore)).toBe(true);
}

const DEFAULT_TILING: CncTiling = { ...DEFAULT_CNC_TILING, registration: REGISTRATION };

describe('tile registration bores miss the parts and stay on the board (N4-P1-1)', () => {
  it('moves a 390 x 300 blank’s bores out of the blank, into the stock margin', () => {
    const job = through({ w: 390, h: 300 });
    const cutterLine = jobBounds(job);
    const stock = grow(cutterLine, 20);
    const result = tiled(job, machineWithStock(stock), DEFAULT_TILING);
    expect(result.tiles).toHaveLength(2);
    const [first, second] = result.tiles.map(boresIn);
    expect(first).toHaveLength(2);
    for (const bore of first ?? []) expectClear(bore, cutterLine, stock);
    // Both tiles drill the same stock positions, so pins re-index the stock.
    expect(new Set(second?.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`))).toEqual(
      new Set(first?.map((b) => `${b.x.toFixed(2)},${b.y.toFixed(2)}`)),
    );
    expect(result.advisories).toEqual(
      expect.arrayContaining([expect.stringContaining('Registration holes, Ø3.18 mm')]),
    );
    // Preview draws the bores the tiled save writes.
    const planned = plannedTileRegistration(job, {
      ...machineWithStock(stock),
      tiling: DEFAULT_TILING,
    });
    expect(planned?.placement.seams.flatMap((seam) => seam.holes)).toHaveLength(2);
  });

  it('drills nothing and names the seam when only the part lies under it', () => {
    const job = through({ w: 390, h: 300 });
    const stock = jobBounds(job);
    const result = tiled(job, machineWithStock(stock), DEFAULT_TILING);
    expect(result.tiles.flatMap(boresIn)).toEqual([]);
    expect(result.advisories).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          'No registration hole fits on the seam between tiles r1-c1 and r1-c2',
        ),
      ]),
    );
  });

  it('keeps every bore of a 600 x 300 panel in 3 x 2 tiles out of the panel and on the board', () => {
    const job = through({ w: 600, h: 300 }, 12);
    const cutterLine = jobBounds(job);
    const stock = grow(cutterLine, 15);
    const result = tiled(job, machineWithStock(stock), {
      ...DEFAULT_TILING,
      tileWidthMm: 250,
      tileHeightMm: 200,
    });
    expect(result.tiles).toHaveLength(6);
    const bores = result.tiles.flatMap(boresIn);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) expectClear(bore, cutterLine, stock);
  });

  it('keeps a long sign’s bores off its lettering pocket and on the board', () => {
    // A 1000 x 150 board cut out, with a pocket filling most of its face.
    const job = compiledRectangles([
      {
        layerId: 'pocket',
        at: [40, 40, 960, 110],
        cnc: { cutType: 'pocket', depthMm: 3, depthPerPassMm: 1.5 },
      },
      {
        layerId: 'outline',
        at: [20, 20, 1000, 150],
        cnc: {
          cutType: 'profile-outside',
          depthMm: 6,
          depthPerPassMm: 2,
          profileLead: { shape: 'none' },
        },
      },
    ]);
    const offset = jobBounds({
      groups: job.groups.filter((group) => group.kind === 'cnc' && group.layerId === 'outline'),
    });
    const stock = grow(offset, 20);
    const result = tiled(job, machineWithStock(stock), DEFAULT_TILING);
    const bores = result.tiles.flatMap(boresIn);
    expect(bores.length).toBeGreaterThan(0);
    for (const bore of bores) expectClear(bore, offset, stock);
  });
});
