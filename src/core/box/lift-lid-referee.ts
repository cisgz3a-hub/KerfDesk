// lift-lid-referee — proves the ADR-693 lift-off lid seats and lifts. The
// body is an ordinary open-top box (checkBoxAssembly runs on its surrogate
// spec); this referee checks what the lid adds, from the generated rings
// only, against sizes re-derived here from the entered dimensions: the lid
// top covers the outer footprint, the lip clears the opening by the full
// joint play (half per side), and no wall rises past the rim the lid rests on.

import type { Polyline } from '../scene';
import type { BoxSpec } from './box-spec';
import { maxOf, minOf } from '../util';

export type LiftLidRefereePart = {
  readonly panel: string;
  readonly outline: Polyline;
};

export type LiftLidRefereeOptions = {
  readonly playMm?: number;
  readonly toleranceMm?: number;
};

const DEFAULT_TOLERANCE_MM = 6e-3;
const WALLS = ['front', 'back', 'left', 'right'] as const;

/** Empty result = the lid covers the box and its lip drops in with play. */
export function checkLiftLidAssembly(
  parts: ReadonlyArray<LiftLidRefereePart>,
  spec: BoxSpec,
  options: LiftLidRefereeOptions = {},
): ReadonlyArray<string> {
  const playMm = options.playMm ?? 0;
  const tolMm = playMm === 0 ? 0 : (options.toleranceMm ?? DEFAULT_TOLERANCE_MM);
  const sizes = requestedSizes(spec);
  const plate = (panel: string, label: string, w: number, d: number, shrinkMm: number) => {
    const part = parts.find((candidate) => candidate.panel === panel);
    return part === undefined
      ? [`${label}: panel missing`]
      : checkPlate(label, part.outline, w, d, shrinkMm, tolMm);
  };
  // The lid top loses play/4 per edge to the fit offset; the lip loses the
  // full play (drawn half, offset half).
  const issues: string[] = [
    ...plate('lid', 'lid', sizes.outerW, sizes.outerD, playMm / 2),
    ...plate('lid-lip', 'lid lip', sizes.innerW, sizes.innerD, playMm),
  ];
  for (const wall of WALLS) {
    const part = parts.find((candidate) => candidate.panel === wall);
    if (part === undefined) {
      issues.push(`${wall}: panel missing`);
      continue;
    }
    const top = maxOf(part.outline.points.map((point) => point.y));
    // The body sums its height layers in another order; allow float dust.
    if (top > sizes.rimZ + Math.max(tolMm, 1e-9 * sizes.rimZ)) {
      issues.push(`${wall}: rises to ${top}, past the ${sizes.rimZ} mm rim the lid rests on`);
    }
  }
  return issues;
}

type RequestedSizes = {
  readonly outerW: number;
  readonly outerD: number;
  readonly innerW: number;
  readonly innerD: number;
  /** Wall rim height: bottom + cavity + lip band. */
  readonly rimZ: number;
};

// Independent of deriveBoxDims: two walls per plan axis, and bottom + cavity
// + lip band + lid top in height.
function requestedSizes(spec: BoxSpec): RequestedSizes {
  const t = spec.thicknessMm;
  if (spec.dimensionMode === 'inner') {
    return {
      outerW: spec.widthMm + 2 * t,
      outerD: spec.depthMm + 2 * t,
      innerW: spec.widthMm,
      innerD: spec.depthMm,
      rimZ: spec.heightMm + 2 * t,
    };
  }
  return {
    outerW: spec.widthMm,
    outerD: spec.depthMm,
    innerW: spec.widthMm - 2 * t,
    innerD: spec.depthMm - 2 * t,
    rimZ: spec.heightMm - t,
  };
}

// A plate must measure its nominal size less the given total shrink.
function checkPlate(
  label: string,
  outline: Polyline,
  nominalW: number,
  nominalD: number,
  shrinkMm: number,
  tolMm: number,
): string[] {
  const xs = outline.points.map((point) => point.x);
  const ys = outline.points.map((point) => point.y);
  const width = maxOf(xs) - minOf(xs);
  const depth = maxOf(ys) - minOf(ys);
  const issues: string[] = [];
  if (Math.abs(width - (nominalW - shrinkMm)) > tolMm) {
    issues.push(`${label}: width ${width}, claimed ${nominalW - shrinkMm}`);
  }
  if (Math.abs(depth - (nominalD - shrinkMm)) > tolMm) {
    issues.push(`${label}: depth ${depth}, claimed ${nominalD - shrinkMm}`);
  }
  return issues;
}
