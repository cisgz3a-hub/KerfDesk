// Import-time check of where vector artwork finally lands (ADR-307 Amendment 5).
//
// The project loader refuses any coordinate past MAX_PROJECT_COORDINATE_MAGNITUDE_MM,
// and Save and autosave run the loader, so an import that stores one leaves a
// project that can never be kept (rolling audit v11 W5-P2-1, W5-P2-2). DXF and
// HPGL move the drawing's corner to 0, place INSERTs and evaluate splines AFTER
// any per-entity gate, so the check must run on the final points. The SVG
// (svg-import-budget.ts) and LightBurn (lbrn-geometry.ts) importers already
// check their final points against the same limit.

import type { Bounds, ColoredPath, CurveSubpath, Vec2 } from '../../core/scene';
import { MAX_PROJECT_COORDINATE_MAGNITUDE_MM } from './project-shape-primitives';

function inRange(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= MAX_PROJECT_COORDINATE_MAGNITUDE_MM;
}

function pointInRange(point: Vec2): boolean {
  return inRange(point.x) && inRange(point.y);
}

// Every point a curve is built from, control points included, as the loader
// validates them.
function curveInRange(curve: CurveSubpath): boolean {
  return (
    pointInRange(curve.start) &&
    curve.segments.every((segment) => {
      if (!pointInRange(segment.to)) return false;
      if (segment.kind === 'cubic') {
        return pointInRange(segment.control1) && pointInRange(segment.control2);
      }
      if (segment.kind === 'elliptical-arc') {
        return inRange(segment.radiusX) && inRange(segment.radiusY);
      }
      return true;
    })
  );
}

export function boundsInRange(bounds: Bounds): boolean {
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(inRange);
}

/** True when every stored point and the bounds are inside the loader's limit. */
export function importedArtworkInRange(bounds: Bounds, paths: ReadonlyArray<ColoredPath>): boolean {
  if (!boundsInRange(bounds)) return false;
  return paths.every(
    (path) =>
      path.polylines.every((polyline) => polyline.points.every(pointInRange)) &&
      (path.curves ?? []).every(curveInRange),
  );
}

const LIMIT_TEXT = MAX_PROJECT_COORDINATE_MAGNITUDE_MM.toLocaleString('en-US');

const formatMm = (value: number): string =>
  Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : `more than ${LIMIT_TEXT}`;

/**
 * The refusal an importer returns instead of artwork the project could not
 * save. It names the extent, the limit and what usually causes it.
 */
export function importedArtworkRangeRefusal(format: 'DXF' | 'HPGL', bounds: Bounds): string {
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return (
    `This ${format} drawing spans ${formatMm(width)} × ${formatMm(height)} mm, but a KerfDesk ` +
    `project holds coordinates only up to ${LIMIT_TEXT} mm, so it could never be saved. ` +
    'Check the file’s units, or delete stray objects far from the design in the program ' +
    'that made it, then import it again.'
  );
}
