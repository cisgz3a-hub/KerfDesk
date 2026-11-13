// Clip one CNC group to one tile rectangle (F-CNC19). Polylines are cut at the
// boundary with entry/exit interpolation (Z included for path3d) and
// translated so the tile's min corner sits at the program origin. Each piece a
// tile edge starts gets the entry its operation asked for
// (tile-clipped-entries.ts) instead of a bare plunge.

import { cncPassXyPoints, type CncGroup, type CncPass } from '../job';
import {
  cncHelicalContourCanEmit,
  cncHelicalContourRepresentedSeamZs,
  type CncHelicalContourPass,
} from '../job/helical-representation';
import { lerp3 } from '../geometry/vec3';
import { sampleCircularArcPoints } from '../geometry/circular-arc';
import type { CncTile } from './cnc-tile';
import { vcarveConservativeZ } from './vcarve-cutting-constraints';
import {
  replanClippedEntries,
  type ClippedPiece,
  type TileEntryReport,
} from './tile-clipped-entries';

const MIN_CLIPPED_POINTS = 2;

type Xyz = { readonly x: number; readonly y: number; readonly z: number };
type Piece = { readonly points: ReadonlyArray<Xyz>; readonly newEntry: boolean };

/** One group clipped to one tile, with what its entries became. */
export type ClippedGroup = {
  readonly group: CncGroup;
  readonly report: TileEntryReport;
};

export function clipGroupToTile(group: CncGroup, tile: CncTile): ClippedGroup | null {
  const pieces = group.passes.flatMap((pass) => clipPass(pass, tile, group.cutType === 'v-carve'));
  if (pieces.length === 0) return null;
  const { passes, report } = replanClippedEntries(group, pieces);
  const tiledRamp = hasEntryRamp(group);
  // Each tile is zeroed on its own frame; the whole job's artwork extent does
  // not describe a clipped tile, so it is not carried into one.
  const { designBounds: _designBounds, ...untiled } = group;
  return {
    group: {
      ...untiled,
      ...(tiledRamp ? { rampEntryTiled: true as const } : {}),
      passes: passes.map((pass) => translatePass(pass, tile)),
    },
    report,
  };
}

/** The XY cutting length of a group's passes, as tiling clips them. */
export function tiledSourceLengthMm(pass: CncPass): number {
  const points = sourcePoints(pass);
  let length = 0;
  const segments =
    pass.closed && pass.kind !== 'helical-contour' ? points.length : points.length - 1;
  for (let i = 0; i < segments; i += 1) {
    const a = points[i] as Xyz;
    const b = points[(i + 1) % points.length] as Xyz;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/** The XY length of the clipped pieces in one tile job (tile coordinates). */
export function clippedLengthMm(passes: ReadonlyArray<CncPass>): number {
  return passes.reduce((sum, pass) => sum + tiledSourceLengthMm(pass), 0);
}

function clipPass(pass: CncPass, tile: CncTile, vcarve: boolean): ClippedPiece[] {
  if (pass.kind === 'contour') {
    // Clipping can remove earlier cutter footprints that proved air clear.
    // Entry advisories transfer; a whole-job clearance certificate does not.
    const { airFloorZMm: _airFloorZMm, ...clipped } = pass;
    return clipPointsToRect(sourcePoints(pass), tile.rect, pass.closed).map((piece) => ({
      // A clipped loop is no longer closed — it continues in a neighbor.
      pass: { ...clipped, closed: false, polyline: xyOf(piece.points) },
      newEntry: piece.newEntry,
    }));
  }
  if (pass.kind === 'path3d') {
    return clipPointsToRect(pass.points, tile.rect, pass.closed).map((piece) => ({
      pass: clippedPath3dPass(pass, piece.points, vcarve),
      newEntry: piece.newEntry,
    }));
  }
  if (pass.kind === 'helical-contour') {
    // The helix's circle cannot be cut whole in a tile it crosses. Its XY
    // (one circle, then the pocket contour) is cut level at the helix's depth,
    // each piece entered by a ramp at the helix's own slope.
    return clipPointsToRect(sourcePoints(pass), tile.rect, false).map((piece) => ({
      pass: {
        kind: 'contour',
        zMm: piece.points[0]?.z ?? pass.zMm,
        closed: false,
        polyline: xyOf(piece.points),
      },
      newEntry: true,
      helixStartZMm: pass.startZMm,
    }));
  }
  return clipPointsToRect(sourcePoints(pass), tile.rect, pass.closed).map((piece) => ({
    pass: { kind: 'contour', zMm: pass.zMm, closed: false, polyline: xyOf(piece.points) },
    newEntry: piece.newEntry,
  }));
}

// The points tiling clips for each pass kind.
function sourcePoints(pass: CncPass): ReadonlyArray<Xyz> {
  switch (pass.kind) {
    case 'contour':
      return pass.polyline.map((point) => ({ x: point.x, y: point.y, z: pass.zMm }));
    case 'path3d':
      return pass.points;
    case 'helical-contour':
      return helixLevelPoints(pass);
    case 'arc':
      return cncPassXyPoints(pass).map((point) => ({ x: point.x, y: point.y, z: pass.zMm }));
  }
}

function helixLevelPoints(pass: CncHelicalContourPass): ReadonlyArray<Xyz> {
  if (!cncHelicalContourCanEmit(pass)) return [];
  const z = cncHelicalContourRepresentedSeamZs(pass).at(-1) ?? pass.zMm;
  const circle = sampleCircularArcPoints({ ...pass, end: pass.start });
  return [...circle, ...pass.polyline].map((point) => ({ x: point.x, y: point.y, z }));
}

function xyOf(points: ReadonlyArray<Xyz>): ReadonlyArray<{ x: number; y: number }> {
  return points.map((point) => ({ x: point.x, y: point.y }));
}

function clippedPath3dPass(
  pass: Extract<CncPass, { readonly kind: 'path3d' }>,
  points: ReadonlyArray<Xyz>,
  vcarve: boolean,
): Extract<CncPass, { readonly kind: 'path3d' }> {
  const { airFloorZMm: _airFloorZMm, ...clipped } = pass;
  return {
    ...clipped,
    closed: false,
    // The V-carve certificate reserves final XY rounding. Keep interpolated
    // Z shallow so this later split cannot consume an additional cone radius.
    points: vcarve
      ? points.map((point) => ({ ...point, z: vcarveConservativeZ(point.z) }))
      : points,
  };
}

function hasEntryRamp(group: CncGroup): boolean {
  return (
    group.rampEntryDeg !== undefined &&
    group.passes.some((pass) => pass.kind === 'path3d' && pass.entryRamp === true)
  );
}

// Keep the in-rect portions of a polyline, interpolating boundary crossings
// (Z rides the same parameter). Closed loops include the seam segment back
// to the start. A piece is a new entry unless it starts where the path did.
function clipPointsToRect(
  points: ReadonlyArray<Xyz>,
  rect: CncTile['rect'],
  closed: boolean,
): Piece[] {
  const pieces: Piece[] = [];
  let current: Xyz[] = [];
  let newEntry = false;
  const flush = (): void => {
    if (current.length >= MIN_CLIPPED_POINTS) pieces.push({ points: current, newEntry });
    current = [];
  };
  const segmentCount = closed ? points.length : points.length - 1;
  for (let i = 0; i < segmentCount; i += 1) {
    const a = points[i] as Xyz;
    const b = points[(i + 1) % points.length] as Xyz;
    const segment = clipSegment(a, b, rect);
    if (segment === null) {
      flush();
      continue;
    }
    const [start, end] = segment;
    if (current.length === 0 || !samePoint(current[current.length - 1] as Xyz, start)) {
      flush();
      current.push(start);
      newEntry = !(i === 0 && samePoint(start, a));
    }
    current.push(end);
  }
  flush();
  return pieces;
}

// Liang–Barsky parametric clip of one segment against the rect; returns the
// clipped endpoints (Z lerped) or null when fully outside.
function clipSegment(a: Xyz, b: Xyz, rect: CncTile['rect']): [Xyz, Xyz] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - rect.minX],
    [dx, rect.maxX - a.x],
    [-dy, a.y - rect.minY],
    [dy, rect.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [lerp3(a, b, t0), lerp3(a, b, t1)];
}

function samePoint(a: Xyz, b: Xyz): boolean {
  const EPSILON = 1e-9;
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function translatePass(pass: CncPass, tile: CncTile): CncPass {
  const dx = tile.rect.minX;
  const dy = tile.rect.minY;
  const shift = (point: { readonly x: number; readonly y: number }) => ({
    x: point.x - dx,
    y: point.y - dy,
  });
  if (pass.kind === 'contour') return { ...pass, polyline: pass.polyline.map(shift) };
  if (pass.kind === 'arc') {
    return {
      ...pass,
      start: shift(pass.start),
      end: shift(pass.end),
      center: shift(pass.center),
    };
  }
  if (pass.kind === 'helical-contour') {
    return {
      ...pass,
      start: shift(pass.start),
      center: shift(pass.center),
      polyline: pass.polyline.map(shift),
    };
  }
  return { ...pass, points: pass.points.map((point) => ({ ...shift(point), z: point.z })) };
}
