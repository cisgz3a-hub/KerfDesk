// Pure rules behind the custom-bit form: which geometry each kind asks for,
// what counts as a physically meaningful entry, and the tool it saves.

import {
  MAX_CNC_TIP_ANGLE_DEG,
  MIN_CNC_TIP_ANGLE_DEG,
  isValidCncTipAngleDeg,
} from '../../core/cnc-tip-angle';
import { isValidCncTipDiameterMm } from '../../core/cnc-tip-diameter';
import {
  isValidTaperedBallTipDiameterMm,
  taperedBallCuttingLengthMm,
  taperedBallEnvelope,
} from '../../core/cnc-tapered-ball';
import type { CncTool, CncToolKind } from '../../core/scene';

export const MAX_TOOL_DIAMETER_MM = 50;
export const MIN_TOOL_DIAMETER_MM = 0.1;
// A tapered ball nose is entered by its PER-SIDE taper, the number sellers
// list; the stored included angle is twice it, so its limits are halved.
export const MIN_TAPER_SIDE_ANGLE_DEG = MIN_CNC_TIP_ANGLE_DEG / 2;
export const MAX_TAPER_SIDE_ANGLE_DEG = MAX_CNC_TIP_ANGLE_DEG / 2;

export type BitFormInput = {
  readonly name: string;
  readonly kind: CncToolKind;
  readonly diameter: string;
  readonly flutes: string;
  readonly tipAngle: string;
  readonly tipDiameter: string;
};

export type BitFormGeometry = {
  readonly needsAngle: boolean;
  readonly anglePerSide: boolean;
  readonly needsTipDiameter: boolean;
  readonly tipRequired: boolean;
};

/** Which geometry fields a cutter kind needs; a v-bit comes to a point by definition. */
export function bitFormGeometry(kind: CncToolKind): BitFormGeometry {
  const taperedBall = kind === 'tapered-ball-nose';
  return {
    needsAngle: kind === 'v-bit' || kind === 'engraving' || taperedBall,
    anglePerSide: taperedBall,
    needsTipDiameter: kind === 'engraving' || taperedBall,
    tipRequired: taperedBall,
  };
}

export function bitFormError(input: BitFormInput): string | null {
  if (input.name.trim() === '') return 'Enter a bit name.';
  const sizeError = diameterError(input.diameter) ?? fluteCountError(input.flutes);
  if (sizeError !== null) return sizeError;
  const geometry = bitFormGeometry(input.kind);
  const angleError = geometry.needsAngle ? tipAngleError(input.tipAngle, geometry) : null;
  if (angleError !== null) return angleError;
  if (!geometry.needsTipDiameter) return null;
  const diameterMm = Number(input.diameter);
  return geometry.tipRequired
    ? ballTipError(input.tipDiameter, diameterMm)
    : tipFlatError(input.tipDiameter, diameterMm);
}

function diameterError(rawValue: string): string | null {
  const diameterMm = Number(rawValue);
  if (
    rawValue.trim() !== '' &&
    Number.isFinite(diameterMm) &&
    diameterMm >= MIN_TOOL_DIAMETER_MM &&
    diameterMm <= MAX_TOOL_DIAMETER_MM
  ) {
    return null;
  }
  return `Enter the actual cutting diameter from ${MIN_TOOL_DIAMETER_MM} to ${MAX_TOOL_DIAMETER_MM} mm.`;
}

function fluteCountError(rawValue: string): string | null {
  const fluteCount = Number(rawValue);
  return rawValue.trim() === '' || !Number.isInteger(fluteCount) || fluteCount < 1
    ? 'Enter the actual flute count as a positive whole number.'
    : null;
}

/** The tool a valid form saves. Call only when bitFormError returns null. */
export function bitFromForm(input: BitFormInput): Omit<CncTool, 'id'> {
  const geometry = bitFormGeometry(input.kind);
  const angleDeg = Number(input.tipAngle);
  return {
    name: input.name.trim(),
    kind: input.kind,
    diameterMm: Number(input.diameter),
    fluteCount: Number(input.flutes),
    ...(geometry.needsAngle
      ? { tipAngleDeg: geometry.anglePerSide ? angleDeg * 2 : angleDeg }
      : {}),
    // Blank stays absent: the simulator reads that as a true point, matching
    // how every tool behaved before the field existed.
    ...(geometry.needsTipDiameter && input.tipDiameter.trim() !== ''
      ? { tipDiameterMm: Number(input.tipDiameter) }
      : {}),
  };
}

/**
 * Where a valid tapered ball nose's flutes reach the entered diameter, so the
 * operator can compare it with the seller's listed cutting length before
 * adding the bit. Null until the entry is complete and valid.
 */
export function taperedBallFormHint(input: BitFormInput): string | null {
  if (input.kind !== 'tapered-ball-nose' || bitFormError(input) !== null) return null;
  const tool = { ...bitFromForm(input), id: 'draft' };
  const envelope = taperedBallEnvelope(tool);
  if (envelope === null) return null;
  const lengthMm = Number(taperedBallCuttingLengthMm(envelope).toFixed(1));
  return (
    `Modeled taper reaches ${tool.diameterMm} mm about ${lengthMm} mm above the tip ` +
    `(${tool.tipAngleDeg}° included). Compare with the listed cutting length.`
  );
}

function tipAngleError(rawValue: string, geometry: BitFormGeometry): string | null {
  const angleDeg = Number(rawValue);
  const includedDeg = geometry.anglePerSide ? angleDeg * 2 : angleDeg;
  if (rawValue.trim() !== '' && isValidCncTipAngleDeg(includedDeg)) return null;
  return geometry.anglePerSide
    ? `Enter the actual taper angle per side from ${MIN_TAPER_SIDE_ANGLE_DEG} to ${MAX_TAPER_SIDE_ANGLE_DEG} degrees.`
    : `Enter the actual included angle from ${MIN_CNC_TIP_ANGLE_DEG} to ${MAX_CNC_TIP_ANGLE_DEG} degrees.`;
}

// Blank is valid — it means the bit comes to a point. A land at or past the
// cutter diameter is not a cone at all, so the cone law would have no flank.
function tipFlatError(tipDiameter: string, diameterMm: number): string | null {
  if (tipDiameter.trim() === '') return null;
  if (!isValidCncTipDiameterMm(Number(tipDiameter), diameterMm)) {
    return `Enter a tip flat from 0 to under the ${diameterMm} mm cutter diameter, or leave it blank for a pointed bit.`;
  }
  return null;
}

// A tapered ball nose without its ball is a V-bit, and a ball as wide as the
// cutter leaves no taper, so the tip is required and must be smaller.
function ballTipError(tipDiameter: string, diameterMm: number): string | null {
  if (
    tipDiameter.trim() !== '' &&
    isValidTaperedBallTipDiameterMm(Number(tipDiameter), diameterMm)
  ) {
    return null;
  }
  return `Enter the ball tip diameter (twice the listed tip radius), above 0 and under the ${diameterMm} mm cut diameter.`;
}
