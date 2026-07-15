// Registration box — a rectangle ShapeObject used as a physical placement jig
// (ADR-057). The operator burns it once, places the workpiece inside the burned
// outline, then burns artwork positioned relative to it. Built on createRectangle
// and bound to the reserved registration layer by color (REGISTRATION_LAYER_COLOR),
// which is how it is identified (findRegistrationBoxes) and drawn distinctly. It is
// movable/removable like any object so the operator can drag it onto the material
// and delete it when done. Pure — no scene mutation, no I/O.

import {
  IDENTITY_TRANSFORM,
  REGISTRATION_LAYER_COLOR,
  REGISTRATION_LAYER_ID,
  type ShapeObject,
} from '../scene';
import { createEllipse } from './create-ellipse';
import { createRectangle } from './create-rectangle';

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

function sanitizeSize(value: number): number {
  return Number.isFinite(value) ? Math.max(MIN_SIZE_MM, value) : MIN_SIZE_MM;
}
