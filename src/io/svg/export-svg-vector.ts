// One vector ColoredPath → SVG markup for the artwork exporter (ADR-403).
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
  type Project,
  type SceneObject,
} from '../../core/scene';
import { effectiveOperationForObject } from '../../core/scene/effective-operation';
import {
  affineMaxGain,
  curvesBounds,
  transformCurveSubpathExact,
} from '../../core/vector-export/affine-curves';
import { groupContoursWithHoles } from '../../core/vector-export/contour-nesting';
import { decimalGridAtMost, type DecimalGrid } from '../../core/vector-export/decimal-grid';
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
  const matrix = svgObjectMatrix(object.transform);
  const grid = localGrid(options.precisionMm, affineMaxGain(matrix));
  const curves = quantizeCurves(path.curves ?? path.polylines.map(polylineToCurveSubpath), grid);
  const operation = project.scene.layers.find((layer) => pathUsesOperation(object, path, layer));
  const fill =
    operation !== undefined && effectiveOperationForObject(operation, object).mode === 'fill';
  const paint: Paint = {
    transform: ' transform="' + svgMatrixAttribute(object.transform) + '"',
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
    bounds: curvesBounds(curves.map((curve) => transformCurveSubpathExact(curve, matrix))),
  };
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
  return options.groupContours ? groupedMarkup(closed, fillPath) : fillPath(closed);
}

function groupedMarkup(
  closed: ReadonlyArray<CurveSubpath>,
  render: (curves: ReadonlyArray<CurveSubpath>) => string,
): string {
  const drawable = closed.filter((curve) => curve.segments.length > 0);
  return groupContoursWithHoles(drawable)
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
