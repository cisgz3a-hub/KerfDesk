// Registration box — a rectangle ShapeObject used as a physical placement jig
// (ADR-057). The operator burns it once, places the workpiece inside the burned
// outline, then burns artwork positioned relative to it. Built on createRectangle
// and bound to the reserved registration layer by color (REGISTRATION_LAYER_COLOR),
// which is how it is identified (findRegistrationBoxes) and drawn distinctly. It is
// movable/removable like any object so the operator can drag it onto the material
// and delete it when done. Pure — no scene mutation, no I/O.

import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  REGISTRATION_LAYER_COLOR,
  REGISTRATION_LAYER_ID,
  type ShapeObject,
  type Vec2,
} from '../scene';
import { CURRENT_POLYLINE_FAIRING_VERSION } from './create-polyline';
import { polylineToPolylines } from './polyline';
import { createEllipse } from './primitives/create-ellipse';
import { createRectangle } from './primitives/create-rectangle';

export const REGISTRATION_BOX_OBJECT_ID = 'registration-box';

// Below ~1 mm a jig outline is uselessly small and risks a degenerate bbox; clamp
// so the generated box is always a real, burnable rectangle.
const MIN_SIZE_MM = 1;

export function createRegistrationBox(args: {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly x?: number;
  readonly y?: number;
  readonly id?: string;
}): ShapeObject {
  const box = createRectangle({
    id: args.id ?? REGISTRATION_BOX_OBJECT_ID,
    color: REGISTRATION_LAYER_COLOR,
    spec: {
      widthMm: sanitizeSize(args.widthMm),
      heightMm: sanitizeSize(args.heightMm),
      cornerRadiusMm: 0,
    },
    transform: { ...IDENTITY_TRANSFORM, x: args.x ?? 0, y: args.y ?? 0 },
  });
  return { ...box, operationIds: [REGISTRATION_LAYER_ID] };
}

export function createRegistrationCircle(args: {
  readonly diameterMm: number;
  readonly x?: number;
  readonly y?: number;
  readonly id?: string;
}): ShapeObject {
  const diameterMm = sanitizeSize(args.diameterMm);
  const circle = createEllipse({
    id: args.id ?? REGISTRATION_BOX_OBJECT_ID,
    color: REGISTRATION_LAYER_COLOR,
    spec: {
      widthMm: diameterMm,
      heightMm: diameterMm,
    },
    transform: { ...IDENTITY_TRANSFORM, x: args.x ?? 0, y: args.y ?? 0 },
  });
  return { ...circle, operationIds: [REGISTRATION_LAYER_ID] };
}

/**
 * A custom-shape board outline (ADR-636): a closed straight-edged polyline
 * through the captured corners. `points` are canvas millimetres relative to the
 * outline's own top-left; `x`/`y` place that corner in the scene. Stamped at the
 * current fairing version so the pen-drawing upgrade never rounds its corners.
 */
export function createRegistrationPolygon(args: {
  readonly points: ReadonlyArray<Vec2>;
  readonly x?: number;
  readonly y?: number;
  readonly id?: string;
}): ShapeObject {
  const spec = { points: args.points, closed: true };
  // Closed outlines repeat their first point, like every materialized shape.
  const polylines = polylineToPolylines(spec);
  const xs = args.points.map((point) => point.x);
  const ys = args.points.map((point) => point.y);
  return {
    kind: 'shape',
    id: args.id ?? REGISTRATION_BOX_OBJECT_ID,
    spec: { kind: 'polyline', ...spec },
    color: REGISTRATION_LAYER_COLOR,
    bounds: {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    },
    transform: { ...IDENTITY_TRANSFORM, x: args.x ?? 0, y: args.y ?? 0 },
    paths: [
      {
        color: REGISTRATION_LAYER_COLOR,
        polylines,
        curves: polylines.map(polylineToCurveSubpath),
      },
    ],
    fairingVersion: CURRENT_POLYLINE_FAIRING_VERSION,
    operationIds: [REGISTRATION_LAYER_ID],
  };
}

function sanitizeSize(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_SIZE_MM, value) : MIN_SIZE_MM;
}
