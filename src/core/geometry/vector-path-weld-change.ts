import { areaD } from 'clipper2-ts';
import type { ImportedSvg, Polyline } from '../scene';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';
import {
  isClosedPolygon,
  materializeVectorObject,
  polylineToPathD,
  type VectorSceneObject,
} from './vector-path-tools';

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

/**
 * Compare Weld's output with its source outlines in linear time, without a
 * second union. Weld only merges overlapping or touching contours, so when no
 * contour is merged, removed or split, the contour count and the summed contour
 * areas match the sources up to Clipper's grid rounding. Union keeps every
 * input vertex that stays on the boundary at its grid-rounded position, so a
 * source with no surviving vertex lies wholly inside other shapes.
 */
export function describeWeldChange(
  sources: ReadonlyArray<VectorSceneObject>,
  welded: ImportedSvg,
): WeldChange {
  const output: OutlineStats = { count: 0, area: 0, perimeter: 0 };
  const survivingVertices = new Set<string>();
  for (const polyline of closedPolylines(welded)) {
    addOutline(output, polyline);
    for (const point of polyline.points) survivingVertices.add(gridKey(point.x, point.y));
  }
  const input: OutlineStats = { count: 0, area: 0, perimeter: 0 };
  const absorbedIds: string[] = [];
  for (const source of sources) {
    let outlines = 0;
    let survives = false;
    for (const polyline of closedPolylines(source)) {
      outlines += 1;
      addOutline(input, polyline);
      survives ||= polyline.points.some((point) =>
        survivingVertices.has(gridKey(point.x, point.y)),
      );
    }
    if (outlines > 0 && !survives) absorbedIds.push(source.id);
  }
  // Rounding each vertex to the grid moves an outline by at most one grid step,
  // which changes its area by at most its perimeter times that step.
  const tolerance = input.perimeter / GRID + 1e-9;
  const changed = output.count !== input.count || Math.abs(output.area - input.area) > tolerance;
  return { changed, absorbedIds };
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
