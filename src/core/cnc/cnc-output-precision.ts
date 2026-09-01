// Shared precision contract between CNC planning and ordinary emitted
// coordinates. The GRBL emitter writes XYZ to three decimal places; only a
// contour whose real XY motion would otherwise disappear may use the narrowest
// per-word representation supported by GRBL's eight parsed input digits (see
// cnc-contour-emission.ts). Mask-aware CAM keeps a full standard-output quantum
// of clearance in XY and Z, so that narrow exception cannot weaken its
// conservative clearance.

import { parseGrblCncCoordinate } from './cnc-grbl-coordinate-parser';

export const CNC_COORDINATE_DECIMAL_PLACES = 3;
export const CNC_COORDINATE_QUANTUM_MM = 10 ** -CNC_COORDINATE_DECIMAL_PLACES;

export type CncCoordinateRepresentation = {
  readonly text: string;
  readonly value: number;
};

/** Text written for an ordinary GRBL CNC coordinate. */
export function formatCncCoordinateMm(value: number): string {
  return value.toFixed(CNC_COORDINATE_DECIMAL_PLACES);
}

/** One formatting pass, retained as both emitted text and controller value. */
export function cncCoordinateRepresentationMm(value: number): CncCoordinateRepresentation {
  const text = formatCncCoordinateMm(value);
  return { text, value: parseGrblCncCoordinate(text) };
}

/** Numeric coordinate the controller receives after ordinary CNC formatting. */
export function representedCncCoordinateMm(value: number): number {
  return cncCoordinateRepresentationMm(value).value;
}

/** Positive stock depth retained as the exact ordinary negative-Z word text. */
export function cncDepthRepresentationMm(depthMm: number): CncCoordinateRepresentation {
  const coordinate = cncCoordinateRepresentationMm(-Math.max(0, depthMm));
  return {
    text: coordinate.text.startsWith('-') ? coordinate.text.slice(1) : coordinate.text,
    value: Math.max(0, -coordinate.value),
  };
}

/** Preserve requested precision only when ordinary emitted text would change it. */
export function requestedCncCoordinateText(value: number): string {
  const text = formatCncCoordinateMm(value);
  return Number(text) === value ? text : String(value);
}

/** Positive stock depth represented by an ordinary negative-Z cut word. */
export function representedCncDepthMm(depthMm: number): number {
  return cncDepthRepresentationMm(depthMm).value;
}

// A rounded XY pair can move by sqrt(2) * quantum/2. One full quantum is a
// simple conservative radial bound and also exceeds either axis's error.
export const CNC_MASK_EMISSION_XY_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;

// Z can round downward by quantum/2. A full quantum keeps the mask constraint
// conservative after the sampled tip surface is stored and emitted.
export const CNC_MASK_EMISSION_Z_CLEARANCE_MM = CNC_COORDINATE_QUANTUM_MM;
