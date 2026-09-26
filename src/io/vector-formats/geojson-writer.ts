// GeoJSON writer (ADR-444), written from RFC 7946.
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
// Filled items become Polygon / MultiPolygon features under the item's own
// fill rule (fill-region-rings): the snapped closed contours that bound the
// filled region become an outer ring and its holes, an island inside a hole
// is its own polygon, and a contour that does not bound the region (a
// same-winding contour nested in another under nonzero, as in text) is left
// out, so the polygons show what the PDF and EPS files paint. Rings follow
// the right-hand rule of section 3.1.6 (exterior counterclockwise, holes
// clockwise, in the y-up frame). Every ring is closed (first position =
// last) and has at least four positions; rings that collapse on the grid are
// dropped. Contours that cross one another are not merged: that item's
// polygons are written as separate features marked "unmerged": true, so the
// file never claims an invalid MultiPolygon, and the caller is told.
// Stroked items become LineString / MultiLineString features (a closed
// contour's line ends where it starts). A bbox member (section 5) gives the
// written extent.

import { flattenCurveSubpath, type CurveSubpath, type Vec2 } from '../../core/scene';
import { formatGridIndex } from '../../core/vector-export/decimal-grid';
import {
  preparePage,
  type GridPoint,
  type PreparedPage,
  type VectorPaintItem,
  type VectorWriteOptions,
} from './vector-artwork';
import { fillRegionPolygons, twiceSignedArea } from './fill-region-rings';

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
  /** Filled items whose contours cross; their polygons are separate, unmerged features. */
  readonly unmergedItemCount: number;
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
  let unmergedItemCount = 0;
  for (const item of items) {
    const { geometries, polygons, lines, unmerged } = itemGeometries(item, page, tolerance);
    polygonCount += polygons;
    lineCount += lines;
    if (unmerged) unmergedItemCount += 1;
    for (const geometry of geometries) {
      extent.addGeometry(geometry);
      const properties = { color: item.color, paint: item.paint, fillRule: item.fillRule };
      features.push(
        JSON.stringify({
          type: 'Feature',
          properties: unmerged ? { ...properties, unmerged: true } : properties,
          geometry,
        }),
      );
    }
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
  return { text, featureCount: features.length, polygonCount, lineCount, unmergedItemCount };
}

function itemGeometries(
  item: VectorPaintItem,
  page: PreparedPage,
  tolerance: number,
): { geometries: Geometry[]; polygons: number; lines: number; unmerged: boolean } {
  const curves = item.curves.filter((curve) => curve.segments.length > 0);
  if (item.paint === 'fill') {
    const { polygons, crossing } = filledPolygons(curves, item.fillRule, page, tolerance);
    const geometries: Geometry[] = crossing
      ? polygons.map((coordinates) => ({ type: 'Polygon', coordinates }))
      : polygons.length === 0
        ? []
        : polygons.length === 1
          ? [{ type: 'Polygon', coordinates: polygons[0] as Position[][] }]
          : [{ type: 'MultiPolygon', coordinates: polygons }];
    return { geometries, polygons: polygons.length, lines: 0, unmerged: crossing };
  }
  const lines = curves
    .map((curve) => lineString(curve, page, tolerance))
    .filter((line): line is Position[] => line !== null);
  const geometries: Geometry[] =
    lines.length === 0
      ? []
      : lines.length === 1
        ? [{ type: 'LineString', coordinates: lines[0] as Position[] }]
        : [{ type: 'MultiLineString', coordinates: lines }];
  return { geometries, polygons: 0, lines: lines.length, unmerged: false };
}

function filledPolygons(
  curves: ReadonlyArray<CurveSubpath>,
  fillRule: VectorPaintItem['fillRule'],
  page: PreparedPage,
  tolerance: number,
): { polygons: Position[][][]; crossing: boolean } {
  const rings = curves
    .map((curve) => openRing(curve, page, tolerance))
    .filter((ring): ring is GridPoint[] => ring !== null);
  const region = fillRegionPolygons(rings, fillRule);
  const closedRing = (index: number, counterclockwise: boolean): Position[] => {
    const ring = rings[index] as GridPoint[];
    return orient([...ring, ring[0] as GridPoint], counterclockwise, page);
  };
  const polygons = region.polygons.map((polygon) => [
    closedRing(polygon.outer, true),
    ...polygon.holes.map((hole) => closedRing(hole, false)),
  ]);
  return { polygons, crossing: region.crossing };
}

/** An open ring on the grid (first point not repeated), or null when it collapses. */
function openRing(curve: CurveSubpath, page: PreparedPage, tolerance: number): GridPoint[] | null {
  const points = dedupe(flattened(curve, tolerance).map(page.toGrid));
  const first = points[0];
  const last = points[points.length - 1];
  if (first !== undefined && last !== undefined && samePoint(first, last) && points.length > 1) {
    points.pop();
  }
  if (points.length < 3 || twiceSignedArea(points) === 0) return null;
  return points;
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
