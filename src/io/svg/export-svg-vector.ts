// One vector ColoredPath → SVG markup for the artwork exporter (ADR-431).
//
// Coordinates stay in the object's local frame under its transform matrix,
// so tiny scales far from the origin keep their physical size. Precision is
// requested in WORLD millimetres: the local grid step is chosen as
// precision / gain, where gain is the matrix's largest singular value, so no
// point moves by more than half a world grid diagonal. Bounds are exact —
// derivative roots for cubics, axis extrema for arcs — of the geometry
// actually written, after the transform.

import {
  pathUsesOperation,
  polylineToCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type EllipticalArcPathSegment,
  type PathSegment,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import {
  affineMaxGain,
  curvesBounds,
  transformCurveSubpathExact,
  type AffineMatrix,
} from '../../core/vector-export/affine-curves';
import { provenContourGroups } from '../../core/vector-export/proven-contour-groups';
import {
  artworkArcEncodingRoundoff,
  artworkArcPoint,
  artworkSvgEncodingError,
  retainArtworkArc,
  retainedArtworkArc,
} from '../../core/vector-export/artwork-parametric-arc';
import {
  decimalGridAtMost,
  gridIndex,
  snapToGrid,
  type DecimalGrid,
} from '../../core/vector-export/decimal-grid';
import { formatSvgPathData, quantizeCurves } from '../../core/vector-export/svg-path-data';
import { svgMatrixAttribute, svgObjectMatrix, xmlText } from './export-svg-paths';

type VectorObject = Extract<SceneObject, { readonly paths: readonly ColoredPath[] }>;

export type SvgVectorOptions = {
  /** World-mm grid for coordinates; null writes every coordinate exactly. */
  readonly precisionMm: number | null;
  /** Wrap each outer contour and its direct holes in its own group. */
  readonly groupContours: boolean;
};

export type SvgVectorElement = { readonly markup: string; readonly bounds: Bounds | null };

export function vectorPathElement(
  object: VectorObject,
  path: ColoredPath,
  project: Project,
  options: SvgVectorOptions,
): SvgVectorElement {
  const geometry = vectorGeometry(object, path, options.precisionMm);
  const { curves, grid } = geometry;
  const operation = project.scene.layers.find((layer) => pathUsesOperation(object, path, layer));
  const fill =
    operation !== undefined && effectiveOperationForObject(operation, object).mode === 'fill';
  const paint: Paint = {
    transform: ' transform="' + geometry.transform + '"',
    color: xmlText(path.color),
    fillRule: path.fillRule ?? (object.kind === 'text' ? 'nonzero' : 'evenodd'),
  };
  const closed = curves.filter((curve) => curve.closed);
  const open = curves.filter((curve) => !curve.closed);
  const closedMarkup = fill ? filledMarkup(closed, grid, paint, options) : '';
  const stroked = fill ? open : curves;
  const strokeMarkup =
    !fill && options.groupContours
      ? groupedMarkup(closed, (group) => strokedPath(group, grid, paint)) +
        strokedPath(open, grid, paint)
      : strokedPath(stroked, grid, paint);
  return {
    markup: closedMarkup + strokeMarkup,
    bounds: geometry.bounds,
  };
}

type VectorGeometry = {
  readonly curves: CurveSubpath[];
  readonly grid: DecimalGrid | null;
  readonly bounds: Bounds | null;
  readonly transform: string;
};

function vectorGeometry(
  object: VectorObject,
  path: ColoredPath,
  precisionMm: number | null,
): VectorGeometry {
  const matrix = svgObjectMatrix(object.transform);
  const authored = path.curves ?? path.polylines.map(polylineToCurveSubpath);
  if (object.transform.scaleX === 0 || object.transform.scaleY === 0) {
    return singularGeometry(authored, matrix, precisionMm);
  }
  const axes = [Math.abs(object.transform.scaleX), Math.abs(object.transform.scaleY)];
  if (Math.min(...axes) / Math.max(...axes) <= Number.EPSILON) {
    const rebased = rebasedGeometry(authored, matrix, precisionMm);
    if (rebased !== null) return rebased;
  }
  const grid = localGrid(precisionMm, affineMaxGain(matrix));
  const curves = quantizeCurves(authored, grid);
  return {
    curves,
    grid,
    bounds: curvesBounds(curves.map((curve) => transformCurveSubpathExact(curve, matrix))),
    transform: svgMatrixAttribute(object.transform),
  };
}

/** Avoid numerically singular renderer CTMs while retaining exact arc encoding. */
function rebasedGeometry(
  authored: readonly CurveSubpath[],
  matrix: AffineMatrix,
  precisionMm: number | null,
): VectorGeometry | null {
  const grid = localGrid(precisionMm, 1);
  const linear = { ...matrix, e: 0, f: 0 };
  const curves = quantizeCurves(
    authored.map((curve) => splitRebasedArcs(transformCurveSubpathExact(curve, linear))),
    grid,
  );
  // An exact source-local A remains available when floating endpoint fields
  // cannot faithfully represent the rebased arc. Numeric output can instead
  // use the formatter's proven world-tolerance fallback.
  if (grid === null && !exactSvgArcs(curves)) return null;
  const translation = { a: 1, b: 0, c: 0, d: 1, e: matrix.e, f: matrix.f };
  return {
    curves,
    grid,
    bounds: curvesBounds(curves.map((curve) => transformCurveSubpathExact(curve, translation))),
    transform: `matrix(1 0 0 1 ${matrix.e} ${matrix.f})`,
  };
}

function splitRebasedArcs(curve: CurveSubpath): CurveSubpath {
  return {
    ...curve,
    segments: curve.segments.flatMap<PathSegment>((segment) =>
      segment.kind === 'elliptical-arc' ? splitRebasedArc(segment) : [segment],
    ),
  };
}

/** Exact quarter arcs keep the excursion's turnaround as an explicit endpoint. */
function splitRebasedArc(segment: EllipticalArcPathSegment): EllipticalArcPathSegment[] {
  const arc = retainedArtworkArc(segment);
  if (arc === null) return [segment];
  const turns = Math.abs(arc.delta) / (Math.PI / 2);
  const count = Math.max(1, Math.ceil(turns - 4 * Number.EPSILON * Math.max(1, turns)));
  return Array.from({ length: count }, (_, index) => {
    const theta1 = arc.theta1 + (arc.delta * index) / count;
    const delta = arc.delta / count;
    const to = index === count - 1 ? segment.to : artworkArcPoint(arc, theta1 + delta);
    return retainArtworkArc({ ...segment, largeArc: false, to }, { ...arc, theta1, delta });
  });
}

function exactSvgArcs(curves: readonly CurveSubpath[]): boolean {
  for (const curve of curves) {
    let from = curve.start;
    for (const segment of curve.segments) {
      if (
        segment.kind === 'elliptical-arc' &&
        !(artworkSvgEncodingError(from, segment) <= artworkArcEncodingRoundoff(from, segment))
      ) {
        return false;
      }
      from = segment.to;
    }
  }
  return true;
}

/** Singular CTMs suppress paint; write the projected traversal under translation. */
function singularGeometry(
  authored: readonly CurveSubpath[],
  matrix: AffineMatrix,
  precisionMm: number | null,
): VectorGeometry {
  const grid = localGrid(precisionMm, 1);
  // Snap once, from unquantized source, in WORLD coordinates. Taking integer
  // grid differences afterwards adds no further displacement and keeps large
  // translations out of the local coordinates consumed by SVG renderers.
  const world = quantizeCurves(
    authored.map((curve) => transformCurveSubpathExact(curve, matrix)),
    grid,
  );
  const x = grid === null ? matrix.e : snapToGrid(matrix.e, grid);
  const y = grid === null ? matrix.f : snapToGrid(matrix.f, grid);
  const relative = (point: { readonly x: number; readonly y: number }) =>
    grid === null
      ? { x: point.x - x, y: point.y - y }
      : {
          x: (gridIndex(point.x, grid) - gridIndex(x, grid)) * grid.step,
          y: (gridIndex(point.y, grid) - gridIndex(y, grid)) * grid.step,
        };
  const curves = world.map((curve) => ({
    ...curve,
    start: relative(curve.start),
    segments: curve.segments.map((segment) =>
      segment.kind === 'cubic'
        ? {
            ...segment,
            control1: relative(segment.control1),
            control2: relative(segment.control2),
            to: relative(segment.to),
          }
        : { ...segment, to: relative(segment.to) },
    ),
  }));
  return { curves, grid, bounds: curvesBounds(world), transform: `matrix(1 0 0 1 ${x} ${y})` };
}

type Paint = { readonly transform: string; readonly color: string; readonly fillRule: string };

function localGrid(precisionMm: number | null, gain: number): DecimalGrid | null {
  if (precisionMm === null || !(precisionMm > 0) || !(gain > 0) || !Number.isFinite(gain)) {
    return null;
  }
  return decimalGridAtMost(precisionMm / gain);
}

function filledMarkup(
  closed: ReadonlyArray<CurveSubpath>,
  grid: DecimalGrid | null,
  paint: Paint,
  options: SvgVectorOptions,
): string {
  const fillPath = (curves: ReadonlyArray<CurveSubpath>): string =>
    curves.length === 0
      ? ''
      : '<path d="' +
        formatSvgPathData(curves, grid) +
        '"' +
        paint.transform +
        ' fill="' +
        paint.color +
        '" fill-rule="' +
        paint.fillRule +
        '" stroke="none"/>';
  return options.groupContours ? groupedMarkup(closed, fillPath, paint.fillRule) : fillPath(closed);
}

function groupedMarkup(
  closed: ReadonlyArray<CurveSubpath>,
  render: (curves: ReadonlyArray<CurveSubpath>) => string,
  fillRule = 'evenodd',
): string {
  const drawable = closed.filter((curve) => curve.segments.length > 0);
  const groups = provenContourGroups(drawable);
  // Parity-based islands also cannot split nested nonzero winding compounds.
  if (
    groups === null ||
    (fillRule !== 'evenodd' && groups.some((group) => group.holes.length > 0))
  ) {
    return drawable.length === 0 ? '' : '<g>' + render(drawable) + '</g>';
  }
  return groups
    .map((group) => {
      const members = [group.outer, ...group.holes].map((index) => drawable[index] as CurveSubpath);
      return '<g>' + render(members) + '</g>';
    })
    .join('');
}

function strokedPath(
  curves: ReadonlyArray<CurveSubpath>,
  grid: DecimalGrid | null,
  paint: Paint,
): string {
  if (curves.length === 0) return '';
  return (
    '<path d="' +
    formatSvgPathData(curves, grid) +
    '"' +
    paint.transform +
    ' fill="none" stroke="' +
    paint.color +
    '" stroke-width="0.1" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>'
  );
}
