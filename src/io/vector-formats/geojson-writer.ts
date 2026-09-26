// GeoJSON writer (ADR-455), written from RFC 7946.
//
// GeoJSON has no curves, so every contour is flattened within a stated
// tolerance (default 0.01 mm) and then snapped to the export grid: each
// written position lies within tolerance + half a grid diagonal of the true
// curve.
//
// Coordinates are NOT longitude/latitude. RFC 7946 section 4 allows another
// coordinate reference system only by prior arrangement; this file states its
// arrangement in a top-level foreign member (section 6.1), "kerfdesk":
// positions are [x, y] in millimetres, x to the right and y UP, with (0, 0)
// at the page's lower-left corner (the artwork's lower-left corner unless a
// page was given). The scene's Y-down frame is mirrored, as DXF export does.
//
// Filled items become Polygon / MultiPolygon features: closed contours are
// grouped by containment into an outer ring and its direct holes (even-odd
// nesting depth, core/vector-export/contour-nesting), an island inside a hole
// is its own polygon, and rings follow the right-hand rule of section 3.1.6
// (exterior counterclockwise, holes clockwise, in the y-up frame). Every ring
// is closed (first position = last) and has at least four positions; rings
// that collapse on the grid are dropped with their holes. Stroked items
// become LineString / MultiLineString features (a closed contour's line ends
// where it starts). A bbox member (section 5) gives the written extent.

import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../core/scene';
import { groupContoursWithHoles } from '../../core/vector-export/contour-nesting';
import { formatGridIndex } from '../../core/vector-export/decimal-grid';
import {
  preparePage,
  type GridPoint,
  type PreparedPage,
  type VectorPaintItem,
  type VectorWriteOptions,
} from './vector-artwork';

export const DEFAULT_GEOJSON_FLATTEN_TOLERANCE_MM = 0.01;

export type GeoJsonWriteOptions = VectorWriteOptions & {
  /** Largest distance between a flattened contour and the true curve. */
  readonly flattenToleranceMm?: number;
};

export type GeoJsonDocument = {
  readonly text: string;
  readonly featureCount: number;
  readonly polygonCount: number;
  readonly lineCount: number;
};

type Position = readonly [number, number];
type Geometry =
  | { readonly type: 'Polygon'; readonly coordinates: Position[][] }
  | { readonly type: 'MultiPolygon'; readonly coordinates: Position[][][] }
  | { readonly type: 'LineString'; readonly coordinates: Position[] }
  | { readonly type: 'MultiLineString'; readonly coordinates: Position[][] };

export function writeGeoJsonDocument(
  items: ReadonlyArray<VectorPaintItem>,
  options: GeoJsonWriteOptions = {},
): GeoJsonDocument {
  const tolerance = options.flattenToleranceMm ?? DEFAULT_GEOJSON_FLATTEN_TOLERANCE_MM;
  if (!(tolerance > 0) || !Number.isFinite(tolerance)) {
    throw new Error('The GeoJSON flattening tolerance must be a positive number of millimetres.');
  }
  const page = preparePage(items, options);
  const features: string[] = [];
  const extent = new Extent();
  let polygonCount = 0;
  let lineCount = 0;
  for (const item of items) {
    const { geometry, polygons, lines } = itemGeometry(item, page, tolerance);
    polygonCount += polygons;
    lineCount += lines;
    if (geometry === null) continue;
    extent.addGeometry(geometry);
    features.push(
      JSON.stringify({
        type: 'Feature',
        properties: { color: item.color, paint: item.paint, fillRule: item.fillRule },
        geometry,
      }),
    );
  }
  if (features.length === 0) throw new Error('There is no vector geometry to write.');
  const header = {
    type: 'FeatureCollection',
    kerfdesk: {
      units: 'mm',
      axes: 'x right, y up; origin at the page lower-left corner',
      flattenToleranceMm: tolerance,
      precisionMm: page.grid.step,
    },
    bbox: extent.bbox(),
  };
  const headerText = JSON.stringify(header);
  const text = headerText.slice(0, -1) + ',"features":[\n' + features.join(',\n') + '\n]}\n';
  return { text, featureCount: features.length, polygonCount, lineCount };
}

function itemGeometry(
  item: VectorPaintItem,
  page: PreparedPage,
  tolerance: number,
): { geometry: Geometry | null; polygons: number; lines: number } {
  const curves = item.curves.filter((curve) => curve.segments.length > 0);
  if (item.paint === 'fill') {
    const polygons = filledPolygons(curves, page, tolerance);
    const geometry: Geometry | null =
      polygons.length === 0
        ? null
        : polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] as Position[][] }
          : { type: 'MultiPolygon', coordinates: polygons };
    return { geometry, polygons: polygons.length, lines: 0 };
  }
  const lines = curves
    .map((curve) => lineString(curve, page, tolerance))
    .filter((line): line is Position[] => line !== null);
  const geometry: Geometry | null =
    lines.length === 0
      ? null
      : lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] as Position[] }
        : { type: 'MultiLineString', coordinates: lines };
  return { geometry, polygons: 0, lines: lines.length };
}

function filledPolygons(
  curves: ReadonlyArray<CurveSubpath>,
  page: PreparedPage,
  tolerance: number,
): Position[][][] {
  const rings = curves.map((curve) => closedRing(curve, page, tolerance));
  const polygons: Position[][][] = [];
  for (const group of groupContoursWithHoles(curves)) {
    const outer = rings[group.outer];
    if (outer === null || outer === undefined) continue;
    const polygon = [orient(outer, true, page)];
    for (const index of group.holes) {
      const hole = rings[index];
      if (hole !== null && hole !== undefined) polygon.push(orient(hole, false, page));
    }
    polygons.push(polygon);
  }
  return polygons;
}

/** A closed ring on the grid (first = last), or null when it collapses. */
function closedRing(
  curve: CurveSubpath,
  page: PreparedPage,
  tolerance: number,
): GridPoint[] | null {
  const points = dedupe(flattened(curve, tolerance).map(page.toGrid));
  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && samePoint(first, last) && points.length > 1) {
    points.pop();
  }
  if (points.length < 3 || twiceSignedArea(points) === 0) return null;
  return [...points, points[0] as GridPoint];
}

function lineString(curve: CurveSubpath, page: PreparedPage, tolerance: number): Position[] | null {
  const points = dedupe(flattened(curve, tolerance).map(page.toGrid));
  const first = points[0];
  if (first === undefined) return null;
  if (
    curve.closed &&
    points.length > 1 &&
    !samePoint(first, points[points.length - 1] as GridPoint)
  ) {
    points.push(first);
  }
  if (points.length < 2) return null;
  return points.map((point) => position(point, page));
}

function flattened(curve: CurveSubpath, tolerance: number): Vec2[] {
  const result = flattenCurveSubpath(curve, { toleranceMm: tolerance });
  if (result.kind !== 'ok') {
    throw new Error(
      'A contour needs more than ' +
        result.segmentBudget +
        ' line segments at this GeoJSON tolerance. Use a coarser tolerance.',
    );
  }
  return [...result.polyline.points];
}

/** Ring in grid units → positions, reversed if needed to the wanted orientation. */
function orient(ring: GridPoint[], counterclockwise: boolean, page: PreparedPage): Position[] {
  const ccw = twiceSignedArea(ring) > 0;
  const ordered = ccw === counterclockwise ? ring : [...ring].reverse();
  return ordered.map((point) => position(point, page));
}

function position(point: GridPoint, page: PreparedPage): Position {
  return [Number(formatGridIndex(point.x, page.grid)), Number(formatGridIndex(point.y, page.grid))];
}

/** Shoelace sum over integer grid indices (exact while |index| stays below 2^25). */
function twiceSignedArea(ring: ReadonlyArray<GridPoint>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as GridPoint;
    const b = ring[(i + 1) % ring.length] as GridPoint;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

function dedupe(points: ReadonlyArray<GridPoint>): GridPoint[] {
  const out: GridPoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last === undefined || !samePoint(last, point)) out.push(point);
  }
  return out;
}

function samePoint(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

class Extent {
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  addGeometry(geometry: Geometry): void {
    const visit = (value: unknown): void => {
      if (Array.isArray(value) && typeof value[0] === 'number') {
        const [x, y] = value as unknown as Position;
        this.minX = Math.min(this.minX, x);
        this.minY = Math.min(this.minY, y);
        this.maxX = Math.max(this.maxX, x);
        this.maxY = Math.max(this.maxY, y);
      } else if (Array.isArray(value)) value.forEach(visit);
    };
    visit(geometry.coordinates);
  }

  bbox(): [number, number, number, number] {
    return [this.minX, this.minY, this.maxX, this.maxY];
  }
}
