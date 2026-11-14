// Does a placed copy of the design stay on its piece (ADR-442 Amendment 2)?
// The design's box, moved and turned exactly as the copy will be
// (`placedObject`: the move, then the turn about the pivot), is sampled about
// every millimetre, and each sample off the material (outside the piece's
// outline, or in one of its holes) is measured to the nearest edge. The
// answer is the furthest any part of the copy runs off: 0 when it fits.
// Pieces saved without holes are judged by their outline. Pure core.

import { pointInPolygon } from '../../geometry';
import type { ArrayPlacement } from '../../scene';
import type { DetectedPiece } from './find-pieces';
import { placementOn, type DesignFrame } from './piece-placements';
import type { Point } from './rotated-rect';

// Samples about this far apart along each side of the design's box, mm.
const SAMPLE_STEP_MM = 1;
const MAX_SAMPLES_PER_SIDE = 80;

/** How far the copy placed by `placement` runs off `piece`, mm; 0 when it lies on it. */
export function offPieceMm(
  piece: DetectedPiece,
  design: DesignFrame,
  placement: ArrayPlacement,
): number {
  let worst = 0;
  for (const point of footprint(design)) {
    const placed = placedPoint(point, placement);
    if (onMaterial(piece, placed)) continue;
    worst = Math.max(worst, distanceToEdges(piece, placed));
  }
  return worst;
}

// Sample points over the design's box, edges included, on the page.
function footprint(design: DesignFrame): Point[] {
  const across = samplesAlong(design.width);
  const down = samplesAlong(design.height);
  const rad = (design.turnDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const points: Point[] = [];
  for (let j = 0; j <= down; j += 1) {
    for (let i = 0; i <= across; i += 1) {
      const u = (i / across - 0.5) * design.width;
      const v = (j / down - 0.5) * design.height;
      points.push({
        x: design.centre.x + u * cos - v * sin,
        y: design.centre.y + u * sin + v * cos,
      });
    }
  }
  return points;
}

function samplesAlong(lengthMm: number): number {
  return Math.min(MAX_SAMPLES_PER_SIDE, Math.max(1, Math.ceil(lengthMm / SAMPLE_STEP_MM)));
}

// Where `point` of the design lands: moved, then turned about the pivot.
function placedPoint(point: Point, placement: ArrayPlacement): Point {
  const moved = { x: point.x + placement.dx, y: point.y + placement.dy };
  const pivot = placement.pivot;
  if (placement.rotationDeg === 0 || pivot === undefined) return moved;
  const rad = (placement.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = moved.x - pivot.x;
  const dy = moved.y - pivot.y;
  return { x: pivot.x + dx * cos - dy * sin, y: pivot.y + dx * sin + dy * cos };
}

function onMaterial(piece: DetectedPiece, point: Point): boolean {
  if (!pointInPolygon(point, piece.outline)) return false;
  return !(piece.holes ?? []).some((hole) => pointInPolygon(point, hole));
}

function distanceToEdges(piece: DetectedPiece, point: Point): number {
  let best = distanceToLoop(piece.outline, point);
  for (const hole of piece.holes ?? []) best = Math.min(best, distanceToLoop(hole, point));
  return best;
}

function distanceToLoop(loop: ReadonlyArray<Point>, p: Point): number {
  let best = Infinity;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    if (a === undefined || b === undefined) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

/** A copy running further off its piece than this is not placed, mm. */
export const PIECE_FIT_LIMIT_MM = 1;

/**
 * The pieces a copy of the design can go on, and those it would run more than
 * {@link PIECE_FIT_LIMIT_MM} off. The sample keeps the design where the
 * operator put it, so it always counts as fitting.
 */
export function piecesTheDesignFits(
  pieces: ReadonlyArray<DetectedPiece>,
  design: DesignFrame,
  sample: DetectedPiece | null,
): { readonly fitting: DetectedPiece[]; readonly runsOff: DetectedPiece[] } {
  const fitting: DetectedPiece[] = [];
  const runsOff: DetectedPiece[] = [];
  for (const piece of pieces) {
    const off =
      piece === sample ? 0 : offPieceMm(piece, design, placementOn(piece, design, sample));
    (off > PIECE_FIT_LIMIT_MM ? runsOff : fitting).push(piece);
  }
  return { fitting, runsOff };
}
