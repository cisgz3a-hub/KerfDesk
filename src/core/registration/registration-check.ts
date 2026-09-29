// Whether a two-point Print and Cut registration looks like the sheet or like
// a capture mistake (ADR-443 Amendment 1). The solve infers the scale and the
// turn from the two captured points, so the same mark captured twice, a jog
// that slipped off a mark, or the targets captured in the swapped order
// rescaled or turned the whole job without a word. A printer scales a sheet
// by a fraction of a percent, so the camera path's 2 % window
// (match-mark-pair.ts) bounds the scale here too, and a turn nearer a half
// turn than a quarter turn is what swapping the targets gives. Any of these
// may still be the sheet (a print scaled on purpose, a sheet laid upside
// down), so they are reported, never refused: the dialog asks the operator to
// confirm one before applying it, and Job Review repeats it at Start. Pure core.

import type { Vec2 } from '../scene';
import {
  solveTwoPointRegistration,
  type SimilarityTransform,
  type TwoPointRegistration,
} from './similarity-transform';

/** Captured spacing may differ from the design's by this share, as print scaling does. */
export const MAX_REGISTRATION_SCALE_ERROR = 0.02;
// Closer targets cannot fix a scale and a turn: jogging onto a mark by eye
// lands about 0.1 mm off, which over 10 mm is already the 2 % scale window and
// a turn of more than half a degree.
export const MIN_TARGET_SEPARATION_MM = 10;
// A turn at least this far from straight is taken for swapped targets.
const SWAPPED_TURN_DEG = 135;

export type RegistrationFigures = {
  /** The captured spacing, print scale and turn, in words. */
  readonly measured: string;
  /** Why the registration looks like a capture mistake; null when it looks like the sheet. */
  readonly unusual: string | null;
};

export type CheckedRegistration =
  | { readonly ok: false; readonly reason: string }
  | ({ readonly ok: true; readonly transform: SimilarityTransform } & RegistrationFigures);

export function checkTwoPointRegistration(registration: TwoPointRegistration): CheckedRegistration {
  const solved = solveTwoPointRegistration(registration);
  if (!solved.ok) return solved;
  return {
    ok: true,
    transform: solved.transform,
    ...registrationFigures(registration.design, solved.transform),
  };
}

/** The figures of a solved registration, from its design targets and its transform. */
export function registrationFigures(
  design: readonly [Vec2, Vec2],
  transform: SimilarityTransform,
): RegistrationFigures {
  const designedMm = distance(design[0], design[1]);
  const capturedMm = transform.scale * designedMm;
  const percent = (transform.scale - 1) * 100;
  const turnDeg = wrappedDegrees((transform.rotationRad * 180) / Math.PI);
  const sign = percent >= 0 ? '+' : '';
  const measured =
    `The captured points are ${capturedMm.toFixed(1)} mm apart ` +
    `(designed ${designedMm.toFixed(1)} mm, print scale ${sign}${percent.toFixed(2)} %), ` +
    `turned ${turnDeg.toFixed(1)}°.`;
  const reasons = [
    Math.min(designedMm, capturedMm) < MIN_TARGET_SEPARATION_MM
      ? `Targets closer than ${MIN_TARGET_SEPARATION_MM} mm cannot fix the scale and turn: place them as far apart as the artwork allows, and capture each on its own mark.`
      : null,
    Math.abs(transform.scale - 1) > MAX_REGISTRATION_SCALE_ERROR
      ? `A print scale more than ${MAX_REGISTRATION_SCALE_ERROR * 100} % off is not the printer: a capture may be off its mark.`
      : null,
    Math.abs(turnDeg) >= SWAPPED_TURN_DEG
      ? 'A turn near 180° is what capturing the two targets in the swapped order gives.'
      : null,
  ].filter((reason): reason is string => reason !== null);
  return { measured, unusual: reasons.length === 0 ? null : reasons.join(' ') };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Degrees in (-180, 180].
function wrappedDegrees(degrees: number): number {
  const turned = degrees % 360;
  if (turned > 180) return turned - 360;
  return turned <= -180 ? turned + 360 : turned;
}
