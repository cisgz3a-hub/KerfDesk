// Offset Shapes (LightBurn gap batch 3, ADR-410). Extends the ADR-103 offset
// with LightBurn's options: Outward, Inward or Both; Round, Bevel or Corner
// joins; Outer Shapes Only; and open paths, which offset outward into a closed
// outline around the line (inward needs a closed shape, as in LightBurn).
// https://docs.lightburnsoftware.com/latest/Reference/OffsetShapes/

import {
  EndType,
  FillRule,
  inflatePathsD,
  isPositiveD,
  JoinType,
  unionD,
  type PathD,
  type PathsD,
} from 'clipper2-ts';
import { err, ok, type Result } from '../result';
import { IDENTITY_TRANSFORM, isClosedEnough, type ColoredPath, type ImportedSvg } from '../scene';
import {
  boundsForPaths,
  isClosedPolygon,
  materializeVectorObject,
  pathDToPolyline,
  polylineToPathD,
  tryVectorOp,
  type VectorOpError,
  type VectorSceneObject,
} from './vector-path-tools';
import { offsetArcToleranceMm } from './offset-arc-tolerance';
import { canonicalizeVectorPaths } from './vector-path-canonical';
import { VECTOR_PATH_PRECISION_DECIMALS } from './vector-path-regions';

export type OffsetDirection = 'outward' | 'inward' | 'both';
export type OffsetCornerStyle = 'round' | 'bevel' | 'corner';

export type OffsetShapesOptions = {
  readonly distanceMm: number;
  readonly direction: OffsetDirection;
  readonly cornerStyle: OffsetCornerStyle;
  /** Ignore holes and shapes inside other shapes; offset only the outer border. */
  readonly outerShapesOnly: boolean;
};

export type OffsetShapesResult = {
  /** The outward offset, or null when Inward was chosen. */
  readonly outward: ImportedSvg | null;
  /** The inward offset, or null when Outward was chosen or it collapsed under Both. */
  readonly inward: ImportedSvg | null;
};

export const OFFSET_SHAPES_MIN_DISTANCE_MM = 0.001;
// "Corner" keeps a true mitre down to about a 29° corner (limit 4 x distance);
// sharper spikes are squared off so a hairline angle cannot shoot out of the art.
const CORNER_MITER_LIMIT = 4;
const DEFAULT_MITER_LIMIT = 2;
const FALLBACK_COLOR = '#000000';

// LightBurn's Corner Style figure cuts a Bevel corner off at the offset
// distance, so its flat sides run on past the corner (ADR-410 Amendment 2).
// That is Clipper's Square join. Clipper's Bevel join cuts between the two
// offset points instead, only 0.71 x the distance from a right-angled corner.
const JOIN_TYPE: Readonly<Record<OffsetCornerStyle, JoinType>> = {
  round: JoinType.Round,
  bevel: JoinType.Square,
  corner: JoinType.Miter,
};

// LightBurn documents no open-path end caps. A line end is a 180° turn, and
// its cap keeps the outline the offset distance clear of the line: Round has
// a half circle; Bevel and Corner have a square cap, which is what their joins
// make of a 180° turn. A flat (butt) cap would cut through the line's end.
const OPEN_END_TYPE: Readonly<Record<OffsetCornerStyle, EndType>> = {
  round: EndType.Round,
  bevel: EndType.Square,
  corner: EndType.Square,
};

type WorldGeometry = { readonly region: PathsD; readonly open: PathsD };

/** Offsets the selection as one design. Each result is a NEW object at world
 * coordinates; the caller decides whether the originals stay. */
export function offsetShapes(
  objects: ReadonlyArray<VectorSceneObject>,
  options: OffsetShapesOptions,
  ids: { readonly outward: string; readonly inward: string },
): Result<OffsetShapesResult, VectorOpError> {
  const first = objects[0];
  if (first === undefined) {
    return err({ kind: 'too-few-objects', message: 'Offset needs at least one vector shape.' });
  }
  if (!Number.isFinite(options.distanceMm) || options.distanceMm < OFFSET_SHAPES_MIN_DISTANCE_MM) {
    return err({
      kind: 'bad-distance',
      message: 'Offset distance must be a positive number of millimeters.',
    });
  }
  const geometry = worldGeometry(objects, options.outerShapesOnly);
  if (geometry.kind === 'error') return geometry;
  const offsets = offsetPaths(geometry.value, options);
  if (offsets.kind === 'error') return offsets;
  const label = `${options.distanceMm} mm`;
  return ok({
    outward: resultObject(ids.outward, `Offset outward (${label})`, offsets.value.outward, first),
    inward: resultObject(ids.inward, `Offset inward (${label})`, offsets.value.inward, first),
  });
}

function offsetPaths(
  geometry: WorldGeometry,
  options: OffsetShapesOptions,
): Result<{ readonly outward: PathsD; readonly inward: PathsD }, VectorOpError> {
  const { region, open } = geometry;
  if (options.direction === 'inward' && region.length === 0) {
    return err({
      kind: 'open-contours',
      message: 'Inward offset needs a closed shape. Choose Outward to outline open lines.',
    });
  }
  const outward = options.direction === 'inward' ? ok([]) : outwardPaths(region, open, options);
  if (outward.kind === 'error') return outward;
  const inward =
    options.direction === 'outward'
      ? ok([])
      : inflate(region, -options.distanceMm, options.cornerStyle, EndType.Polygon);
  if (inward.kind === 'error') return inward;
  if (options.direction === 'inward' && inward.value.length === 0) {
    return err({
      kind: 'collapsed',
      message: 'The inward offset collapsed the shape. Use a smaller distance.',
    });
  }
  // ADR-410 item 3: Offset is unavailable, with the reason, when it makes nothing.
  if (outward.value.length === 0 && inward.value.length === 0) {
    return err({
      kind: 'empty-result',
      message: 'Nothing to offset: the selection has no shape or line to outline.',
    });
  }
  return ok({ outward: outward.value, inward: inward.value });
}

function outwardPaths(
  region: PathsD,
  open: PathsD,
  options: OffsetShapesOptions,
): Result<PathsD, VectorOpError> {
  const closed = inflate(region, options.distanceMm, options.cornerStyle, EndType.Polygon);
  if (closed.kind === 'error') return closed;
  const lines = inflate(
    open,
    options.distanceMm,
    options.cornerStyle,
    OPEN_END_TYPE[options.cornerStyle],
  );
  if (lines.kind === 'error') return lines;
  return unionAll([...closed.value, ...lines.value]);
}

function inflate(
  paths: PathsD,
  delta: number,
  cornerStyle: OffsetCornerStyle,
  endType: EndType,
): Result<PathsD, VectorOpError> {
  if (paths.length === 0) return ok([]);
  return tryVectorOp(() =>
    canonicalizeVectorPaths(
      inflatePathsD(
        paths,
        delta,
        JOIN_TYPE[cornerStyle],
        endType,
        cornerStyle === 'corner' ? CORNER_MITER_LIMIT : DEFAULT_MITER_LIMIT,
        VECTOR_PATH_PRECISION_DECIMALS,
        offsetArcToleranceMm(delta),
      ),
    ),
  );
}

function worldGeometry(
  objects: ReadonlyArray<VectorSceneObject>,
  outerShapesOnly: boolean,
): Result<WorldGeometry, VectorOpError> {
  const closedBatches: PathsD = [];
  const open: PathsD = [];
  for (const object of objects) {
    const materialized = tryVectorOp(() => materializeVectorObject(object));
    if (materialized.kind === 'error') return materialized;
    for (const path of materialized.value.paths) {
      const batch = splitPath(path);
      const normalized = normalizeBatch(batch.closed, path);
      if (normalized.kind === 'error') return normalized;
      closedBatches.push(...normalized.value);
      open.push(...batch.open);
    }
  }
  const region = unionAll(closedBatches);
  if (region.kind === 'error') return region;
  if (!outerShapesOnly) return ok({ region: region.value, open });
  const outers = unionAll(region.value.filter((path) => isPositiveD(path)));
  if (outers.kind === 'error') return outers;
  return ok({ region: outers.value, open });
}

function splitPath(path: ColoredPath): { readonly closed: PathsD; readonly open: PathsD } {
  const closed: PathD[] = [];
  const open: PathD[] = [];
  for (const polyline of path.polylines) {
    if (isClosedPolygon(polyline) || isClosedEnough(polyline)) {
      const ring = polylineToPathD(polyline);
      // Signed area can cancel between filled lobes of a self-intersection.
      // Rings that are collinear, including after region-grid quantization,
      // are strokes. Normalize other rings under the path's fill rule first.
      if (ring.length >= 3 && !collinearRing(ring) && !collinearOnRegionGrid(ring))
        closed.push(ring);
      else if (ring.length >= 2) open.push(ring.concat(ring.slice(0, 1)));
    } else if (polyline.points.length >= 2) {
      open.push(polyline.points.map((point) => ({ x: point.x, y: point.y })));
    }
  }
  return { closed, open };
}

// A rotated or scaled straight line comes out of materialization a few ulps off
// exact collinearity, so "on the line" means within half the 1 µm grid that the
// filled region is normalized on.
const COLLINEAR_TOLERANCE_MM = 0.5 / 10 ** VECTOR_PATH_PRECISION_DECIMALS;

function collinearRing(ring: PathD, tolerance = COLLINEAR_TOLERANCE_MM): boolean {
  const first = ring[0];
  if (first === undefined) return true;
  // The vertex farthest from the first fixes the line's direction; two close
  // vertices would give a direction that the tolerance cannot bound.
  let far = first;
  let farSq = 0;
  for (const point of ring) {
    const distanceSq = (point.x - first.x) ** 2 + (point.y - first.y) ** 2;
    if (distanceSq > farSq) {
      far = point;
      farSq = distanceSq;
    }
  }
  if (farSq === 0) return true;
  const dx = far.x - first.x;
  const dy = far.y - first.y;
  const limit = tolerance * Math.sqrt(farSq);
  return ring.every(
    (point) => Math.abs(dx * (point.y - first.y) - dy * (point.x - first.x)) <= limit,
  );
}

// A noncollinear sliver can become a line on Clipper's normalization grid.
// Outline that line as a stroke, but do not resurrect noncollinear rings whose
// filled areas cancel under their fill rule (for example a repeated traversal).
function collinearOnRegionGrid(ring: PathD): boolean {
  const scale = 10 ** VECTOR_PATH_PRECISION_DECIMALS;
  return collinearRing(
    ring.map(({ x, y }) => ({ x: Math.round(x * scale), y: Math.round(y * scale) })),
    0,
  );
}

// Each ColoredPath is its own fill batch, under the rule the canvas and CAM use.
function normalizeBatch(rings: PathsD, path: ColoredPath): Result<PathsD, VectorOpError> {
  if (rings.length === 0) return ok([]);
  const fillRule = path.fillRule === 'nonzero' ? FillRule.NonZero : FillRule.EvenOdd;
  return tryVectorOp(() =>
    canonicalizeVectorPaths(unionD(rings, [], fillRule, VECTOR_PATH_PRECISION_DECIMALS)),
  );
}

function unionAll(paths: PathsD): Result<PathsD, VectorOpError> {
  if (paths.length === 0) return ok([]);
  return tryVectorOp(() =>
    canonicalizeVectorPaths(unionD(paths, [], FillRule.NonZero, VECTOR_PATH_PRECISION_DECIMALS)),
  );
}

// An empty offset (the direction was not asked for, or it collapsed under
// Both) is no object at all.
function resultObject(
  id: string,
  source: string,
  pathsD: PathsD,
  subject: VectorSceneObject,
): ImportedSvg | null {
  if (pathsD.length === 0) return null;
  const paths: ColoredPath[] = [
    { color: subject.paths[0]?.color ?? FALLBACK_COLOR, polylines: pathsD.map(pathDToPolyline) },
  ];
  return {
    ...(subject.powerScale === undefined ? {} : { powerScale: subject.powerScale }),
    ...(subject.operationOverride === undefined
      ? {}
      : { operationOverride: subject.operationOverride }),
    kind: 'imported-svg',
    id,
    source,
    bounds: boundsForPaths(paths) ?? subject.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}
