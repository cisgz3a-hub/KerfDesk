import { areaD, differenceD, FillRule, type PathsD } from 'clipper2-ts';
import type { Bounds, ImportedSvg, Polyline } from '../scene';
import { boundsOverlap } from './trim-contours';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';
import {
  boundsForPaths,
  isClosedPolygon,
  materializeVectorObject,
  polylineToPathD,
  tryVectorOp,
  type VectorSceneObject,
} from './vector-path-tools';
import { weldBatchPieces, type WeldBatchPiece } from './vector-path-weld';

export const NOTHING_TO_WELD_MESSAGE =
  'Nothing to weld: no selected shapes overlap within the same operation and settings. To merge shapes across operations or settings, use Tools → Union silhouette.';

/** What a settled Weld result changes relative to its sources. */
export type WeldChange = {
  /** False when Weld would only flatten the sources into one object with the same outlines. */
  readonly changed: boolean;
  /** Sources whose every outline lies inside another shape of the same operation, so Weld removes them. */
  readonly absorbedIds: ReadonlyArray<string>;
};

const GRID = 10 ** VECTOR_PATH_PRECISION_DECIMALS;

type OutlineStats = { count: number; area: number; perimeter: number };

type SourceOutline = {
  readonly source: VectorSceneObject;
  readonly bounds: Bounds | null;
  /** No vertex of the source survives on the welded outline. */
  readonly candidate: boolean;
};

/**
 * Compare Weld's output count and area with its sources before checking coverage.
 * Weld only merges overlapping or touching contours, so when no
 * contour is merged, removed or split, the contour count and the summed contour
 * areas match the sources up to Clipper's grid rounding.
 *
 * A source whose vertex survives on the welded outline is never absorbed.
 * Losing every vertex is not enough to be absorbed, though: a bar whose ends
 * sit inside two shapes keeps only intersection points, yet its middle is the
 * bridge between them (audit 2026-10-21 geometry P2-1). Such candidates are
 * absorbed only when the rest of their Weld batch covers them.
 */
export function describeWeldChange(
  sources: ReadonlyArray<VectorSceneObject>,
  welded: ImportedSvg,
): WeldChange {
  const { changed, outlines } = compareOutlines(sources, welded);
  return { changed, absorbedIds: absorbedSourceIds(outlines) };
}

/** `describeWeldChange(...).changed` without looking for absorbed sources. */
export function weldChangesOutlines(
  sources: ReadonlyArray<VectorSceneObject>,
  welded: ImportedSvg,
): boolean {
  return compareOutlines(sources, welded).changed;
}

function compareOutlines(
  sources: ReadonlyArray<VectorSceneObject>,
  welded: ImportedSvg,
): { readonly changed: boolean; readonly outlines: ReadonlyArray<SourceOutline> } {
  const output: OutlineStats = { count: 0, area: 0, perimeter: 0 };
  const survivingVertices = new Set<string>();
  for (const polyline of closedPolylines(welded)) {
    addOutline(output, polyline);
    for (const point of polyline.points) survivingVertices.add(gridKey(point.x, point.y));
  }
  const input: OutlineStats = { count: 0, area: 0, perimeter: 0 };
  const outlines: SourceOutline[] = [];
  for (const source of sources) {
    const own: OutlineStats = { count: 0, area: 0, perimeter: 0 };
    const polylines = closedPolylines(source);
    let survives = false;
    for (const polyline of polylines) {
      addOutline(own, polyline);
      survives ||= polyline.points.some((point) =>
        survivingVertices.has(gridKey(point.x, point.y)),
      );
    }
    input.count += own.count;
    input.area += own.area;
    input.perimeter += own.perimeter;
    outlines.push({
      source,
      bounds: boundsForPaths([{ color: '', polylines }]),
      candidate: own.count > 0 && !survives,
    });
  }
  // Rounding each vertex to the grid moves an outline by at most one grid step,
  // which changes its area by at most its perimeter times that step.
  const tolerance = input.perimeter / GRID + 1e-9;
  const changed = output.count !== input.count || Math.abs(output.area - input.area) > tolerance;
  return { changed, outlines };
}

/**
 * Candidates whose every Weld batch piece the other sources of that batch cover,
 * up to grid rounding. A source found absorbed no longer covers later ones, so
 * removing every named source together leaves the welded region unchanged: of two
 * identical bridges, only the first is named.
 */
function absorbedSourceIds(outlines: ReadonlyArray<SourceOutline>): string[] {
  const candidates = outlines.filter((outline) => outline.candidate);
  if (candidates.length === 0) return [];
  // Only sources that reach a candidate's bounds can cover it.
  const pieces = new Map<SourceOutline, ReadonlyArray<WeldBatchPiece>>();
  for (const outline of outlines) {
    if (!candidates.some((candidate) => near(candidate, outline))) continue;
    const result = weldBatchPieces(outline.source);
    pieces.set(outline, result.kind === 'ok' ? result.value : []);
  }
  const absorbed = new Set<SourceOutline>();
  for (const candidate of candidates) {
    const own = pieces.get(candidate) ?? [];
    const covers = (other: SourceOutline): boolean =>
      other !== candidate && !absorbed.has(other) && near(candidate, other);
    const covered = own.length > 0 && own.every((piece) => pieceCovered(piece, pieces, covers));
    if (covered) absorbed.add(candidate);
  }
  return candidates
    .filter((candidate) => absorbed.has(candidate))
    .map((candidate) => candidate.source.id);
}

function pieceCovered(
  piece: WeldBatchPiece,
  pieces: ReadonlyMap<SourceOutline, ReadonlyArray<WeldBatchPiece>>,
  covers: (other: SourceOutline) => boolean,
): boolean {
  let remaining: PathsD = piece.batch.paths;
  for (const [outline, otherPieces] of pieces) {
    if (!covers(outline)) continue;
    for (const other of otherPieces) {
      if (other.key !== piece.key) continue;
      const uncovered = tryVectorOp(() =>
        differenceD(remaining, other.batch.paths, FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS),
      );
      if (uncovered.kind === 'error') return false;
      remaining = uncovered.value;
      // Stop as soon as the whole contribution is covered. An enclosing source
      // should not require rebuilding all other regions for every inner object.
      if (remaining.length === 0) return true;
    }
  }
  // Both operands are already normalized onto the same grid. Any remaining
  // region is a real contribution; a large source perimeter must not hide a
  // small but still surviving bridge under an area tolerance.
  return false;
}

function near(a: SourceOutline, b: SourceOutline): boolean {
  return a.bounds !== null && b.bounds !== null && boundsOverlap(a.bounds, b.bounds, 1 / GRID);
}

function closedPolylines(object: VectorSceneObject): Polyline[] {
  return materializeVectorObject(object)
    .paths.flatMap((path) => path.polylines)
    .filter(isClosedPolygon);
}

function addOutline(stats: OutlineStats, polyline: Polyline): void {
  const path = polylineToPathD(polyline);
  stats.count += 1;
  stats.area += Math.abs(areaD(path));
  for (let index = 0; index < path.length; index += 1) {
    const from = path[index];
    const to = path[(index + 1) % path.length];
    if (from !== undefined && to !== undefined) {
      stats.perimeter += Math.hypot(to.x - from.x, to.y - from.y);
    }
  }
}

function gridKey(x: number, y: number): string {
  return `${Math.round(x * GRID)},${Math.round(y * GRID)}`;
}
