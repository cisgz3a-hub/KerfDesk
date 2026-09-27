// Which drawing of a big program the view shows (ADR-485, move-detail.ts).
// Before each frame the view works out how many millimetres a pixel spans at
// the nearest part of the job and shows the coarsest simplified drawing whose
// lines stay within half a pixel of every move, or every move once zoomed in
// past all of them. The drawn path is simplified only while it shows the
// whole program; during playback the done moves are drawn one by one and only
// the faint copy of the moves to come is simplified. A legend filter draws
// every move (the drawings are built for the whole program).

import type { OrthographicCamera, PerspectiveCamera } from 'three';
import type { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import type { AxisBounds } from '../../core/gcode-view';
import { disposeDetailLines, type DetailLines } from './detail-lines';

const HALF_PIXEL = 0.5;

/** What the view says about a simplified drawing (ADR-485). */
export type Viewer3dDetail = {
  /** Lines drawn. */
  readonly drawn: number;
  /** Solid moves they stand for. */
  readonly moves: number;
  /** How far any move may be from its line, in mm. */
  readonly toleranceMm: number;
};

export type DetailTargets = {
  /** The drawn path and its faint copy, whose geometry is swapped. */
  readonly lines: { geometry: LineSegmentsGeometry };
  readonly ghost: { geometry: LineSegmentsGeometry };
  /** Every move, as built for the program. */
  readonly full: { readonly lines: LineSegmentsGeometry; readonly ghost: LineSegmentsGeometry };
  readonly levels: ReadonlyArray<DetailLines>;
  readonly moves: number;
};

/** The coarsest level whose lines stay within half a pixel; -1 draws every move. */
export function detailLevelFor(
  levels: ReadonlyArray<{ readonly toleranceMm: number }>,
  mmPerPixel: number,
): number {
  return levels.findIndex((level) => level.toleranceMm <= mmPerPixel * HALF_PIXEL);
}

/** Millimetres one CSS pixel spans at the part of the job nearest the camera. */
export function mmPerPixel(
  camera: PerspectiveCamera | OrthographicCamera,
  bounds: AxisBounds | null,
  heightPx: number,
): number {
  if (heightPx <= 0) return 0;
  if ('isOrthographicCamera' in camera) {
    return (camera.top - camera.bottom) / camera.zoom / heightPx;
  }
  const distance = Math.max(camera.near, distanceToBox(camera.position, bounds));
  const halfAngle = (camera.fov * Math.PI) / 360;
  return (2 * distance * Math.tan(halfAngle)) / camera.zoom / heightPx;
}

/** Shows the level the zoom calls for and says what the drawn path shows. */
export function applyDetail(
  targets: DetailTargets,
  view: { readonly wholePath: boolean; readonly mmPerPixel: number },
): Viewer3dDetail | null {
  const chosen = targets.levels[detailLevelFor(targets.levels, view.mmPerPixel)] ?? null;
  targets.ghost.geometry = chosen?.ghostGeometry ?? targets.full.ghost;
  const drawn = view.wholePath ? chosen : null;
  targets.lines.geometry = drawn?.geometry ?? targets.full.lines;
  if (drawn === null) return null;
  return { drawn: drawn.count, moves: targets.moves, toleranceMm: drawn.toleranceMm };
}

/** Frees every drawing, whichever one is showing. */
export function disposeDetail(targets: DetailTargets | null): void {
  if (targets === null) return;
  targets.full.lines.dispose();
  targets.full.ghost.dispose();
  disposeDetailLines(targets.levels);
}

export function sameDetail(left: Viewer3dDetail | null, right: Viewer3dDetail | null): boolean {
  if (left === null || right === null) return left === right;
  return left.drawn === right.drawn && left.toleranceMm === right.toleranceMm;
}

function distanceToBox(
  point: { readonly x: number; readonly y: number; readonly z: number },
  bounds: AxisBounds | null,
): number {
  if (bounds === null) return 0;
  const dx = Math.max(bounds.minX - point.x, 0, point.x - bounds.maxX);
  const dy = Math.max(bounds.minY - point.y, 0, point.y - bounds.maxY);
  const dz = Math.max(bounds.minZ - point.z, 0, point.z - bounds.maxZ);
  return Math.hypot(dx, dy, dz);
}
