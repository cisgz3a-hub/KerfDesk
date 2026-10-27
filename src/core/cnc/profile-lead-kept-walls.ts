// The kept material a CNC profile lead must stay clear of (ADR-250
// Amendment 3). A lead used to be checked only against the other contours of
// its own operation, and never against the wall of a hole its part sits in, so
// a default arc lead could plunge into a kept part on another operation, or
// into the hole wall around a nested part, whenever parts were closer than
// about three cutter radii (audit 2026-10-21 09-P1-1).
//
// Every finished wall of every profile operation in the job is listed here
// with the side of it that the job keeps. A lead is safe from a wall when the
// whole cutter disk swept along the lead stays on that wall's waste side. A
// wall whose kept side already holds the lead's start is skipped: that is the
// outer boundary of a larger part this cut lies inside, and its kept material
// sits behind a nearer wall (the hole) that is checked instead.

import { pointInPolygon } from '../geometry';
import { normalizeClosedPolylineTreeEvenOddChecked } from '../geometry/polygon-difference';
import type { CncCutType, CncLayerSettings, CncTool, Polyline, Vec2 } from '../scene';
import { cutTypeFillsClosedOutlines, withoutStackedClosedCopies } from './cnc-stacked-copies';
import { cncLayoutCutWidths } from './layout-cut-widths';
import { segmentsStayOnSide } from './profile-lead-side-crossings';
import { hasFinitePoints } from './profile-paths';
import { segmentToSegmentDistance } from './vcarve-detail-geometry';

/** One finished profile wall and the side of it the job keeps. */
export type ProfileLeadKeptWall = {
  readonly ring: ReadonlyArray<Vec2>;
  /** True when the kept material lies inside the ring. */
  readonly keptInside: boolean;
  /** How far past the ring the wall's own cut already removes material:
   * zero for an outside or inside path, the cutter radius for an on-path cut. */
  readonly clearedMm: number;
  /** The operation that keeps it; set for the job's walls (ADR-433 Amendment 3). */
  readonly layerId?: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** The job's kept walls and the cutter radius a lead sweeps at full depth. */
export type ProfileLeadKeptMaterial = {
  readonly walls: ReadonlyArray<ProfileLeadKeptWall>;
  readonly cutterRadiusMm: number;
};

/** What one operation's leads must clear: the job's walls and its own cutter. */
export function profileLeadKeptMaterial(
  walls: ReadonlyArray<ProfileLeadKeptWall>,
  tool: CncTool,
  settings: Pick<CncLayerSettings, 'depthMm' | 'depthPerPassMm'>,
): ProfileLeadKeptMaterial {
  return { walls, cutterRadiusMm: profileLeadCutWidthMm(tool, settings) / 2 };
}

/** The width the profile offset uses: the cut at full depth, which is the
 * widest the cutter sweeps anywhere along the pass (ADR-368 Amendment 2). */
export function profileLeadCutWidthMm(
  tool: CncTool,
  settings: Pick<CncLayerSettings, 'depthMm' | 'depthPerPassMm'>,
): number {
  return cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm).wallDiameterMm;
}

// The kerf offset and the emitter both round to 0.001 mm, and the offset drops
// needle segments under 0.005 mm, so a contour can ride a few microns inside
// its own cutter radius. Only a real approach past that counts as a gouge.
export const KEPT_WALL_TOLERANCE_MM = 0.005;
const MIN_RING_POINTS = 3;

/**
 * The walls one profile operation leaves, from the same selected contours its
 * kerf offset uses. Outside and on-path cuts keep the even-odd bodies (a hole
 * keeps the material around it); an inside cut keeps the opposite side. An
 * on-path operation's stacked copies count once.
 */
export function profileLeadKeptWalls(
  contours: ReadonlyArray<Polyline>,
  cutType: CncCutType,
  cutWidthMm: number,
): ReadonlyArray<ProfileLeadKeptWall> {
  if (
    cutType !== 'profile-outside' &&
    cutType !== 'profile-inside' &&
    cutType !== 'profile-on-path'
  ) {
    return [];
  }
  const closed = contours.filter(
    (contour) =>
      contour.closed && contour.points.length >= MIN_RING_POINTS && hasFinitePoints(contour),
  );
  // An On path cut follows each outline, so a stacked copy is the same line
  // cut again and leaves the same wall. Filled even-odd, the copy would cancel
  // its twin and leave the part no wall at all (ADR-250 Amendment 4). Filled
  // cuts merged their copies as they were collected (ADR-359 Amendment 3), so
  // their walls read the contours their kerf offset reads.
  const outlines = cutTypeFillsClosedOutlines(cutType)
    ? closed
    : withoutStackedClosedCopies(closed);
  const tree = normalizeClosedPolylineTreeEvenOddChecked(outlines);
  // The kerf offset runs the same normalization; if it fails, this operation
  // cuts nothing, so it leaves no wall to protect.
  if (tree.kind === 'error') return [];
  const clearedMm = cutType === 'profile-on-path' ? Math.max(0, cutWidthMm) / 2 : 0;
  return tree.value.map((node) =>
    keptWall(node.contour.points, (cutType === 'profile-inside') === node.isHole, clearedMm),
  );
}

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

function keptWall(
  ring: ReadonlyArray<Vec2>,
  keptInside: boolean,
  clearedMm: number,
): ProfileLeadKeptWall {
  return { ring, keptInside, clearedMm, ...pointsBox(ring, 0) };
}

// A loop, not Math.min(...points): an imported ring can hold more vertices
// than a call's argument list allows.
function pointsBox(points: ReadonlyArray<Vec2>, marginMm: number): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - marginMm,
    minY: minY - marginMm,
    maxX: maxX + marginMm,
    maxY: maxY + marginMm,
  };
}

/**
 * True when the cutter disk swept along the lead-in and lead-out reaches no
 * kept material. `leadIn` ends on, and `leadOut` starts on, the contour start.
 */
export function leadClearsKeptWalls(
  leadIn: ReadonlyArray<Vec2>,
  leadOut: ReadonlyArray<Vec2>,
  kept: ProfileLeadKeptMaterial,
): boolean {
  const start = leadIn.at(-1);
  if (start === undefined || kept.walls.length === 0) return true;
  const path = [...leadIn, ...leadOut.slice(1)];
  const reach = Math.max(0, kept.cutterRadiusMm);
  const box = pointsBox(path, reach);
  return kept.walls.every(
    (wall) => !boxesOverlap(box, wall) || pathClearsWall(path, start, reach, wall),
  );
}

function boxesOverlap(box: Box, wall: ProfileLeadKeptWall): boolean {
  return (
    box.minX <= wall.maxX && box.maxX >= wall.minX && box.minY <= wall.maxY && box.maxY >= wall.minY
  );
}

function pathClearsWall(
  path: ReadonlyArray<Vec2>,
  start: Vec2,
  cutterRadiusMm: number,
  wall: ProfileLeadKeptWall,
): boolean {
  const startInside = pointInPolygon(start, wall.ring);
  if (startInside === wall.keptInside) return true;
  if (!path.every((point) => pointInPolygon(point, wall.ring) === startInside)) return false;
  if (!segmentsStayOnSide(path, wall.ring, startInside)) return false;
  const required = cutterRadiusMm - wall.clearedMm - KEPT_WALL_TOLERANCE_MM;
  return required <= 0 || pathRingDistance(path, wall.ring) >= required;
}

function pathRingDistance(path: ReadonlyArray<Vec2>, ring: ReadonlyArray<Vec2>): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % ring.length] as Vec2;
    const edge = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    for (let j = 1; j < path.length; j += 1) {
      best = Math.min(best, segmentToSegmentDistance(path[j - 1] as Vec2, path[j] as Vec2, edge));
    }
  }
  return best;
}
