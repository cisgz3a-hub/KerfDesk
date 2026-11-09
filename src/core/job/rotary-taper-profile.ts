// The cone a rotary taper warp maps onto (ADR-694), as plain data, and the
// point maths every stage shares: the warp itself (rotary-taper-warp.ts), its
// raster resampling (rotary-taper-raster.ts), the canvas Frame outline that
// maps machine points back, and the surface-feed match, which needs the local
// Y factor (ADR-127 Amendment 2 composes with ADR-694).

import type { Vec2 } from '../scene';

export type RotaryTaperProfile = {
  /** Radius the rotary's Y scale turns surface mm at (Object diameter / 2). */
  readonly referenceRadiusMm: number;
  /** Job X of the object's top edge. */
  readonly topX: number;
  /** +1 when distance from the top grows with X (top on the left), else −1. */
  readonly direction: 1 | -1;
  readonly topRadiusMm: number;
  readonly bottomRadiusMm: number;
  /** Top edge to bottom edge along the side. */
  readonly lengthMm: number;
  /** Row the warp keeps fixed: the placement anchor, or an Absolute job's middle. */
  readonly baseY: number;
};

/** The cone's radius under job X. It holds its end value past either end of
 * the part, where the head is off the part anyway. */
export function rotaryTaperRadiusAt(profile: RotaryTaperProfile, x: number): number {
  const along = profile.direction * (x - profile.topX);
  const s = Math.min(profile.lengthMm, Math.max(0, along));
  const change = profile.bottomRadiusMm - profile.topRadiusMm;
  return profile.topRadiusMm + change * (s / profile.lengthMm);
}

/** Machine Y per Y-scaled surface mm at job X, relative to the reference
 * diameter; 1 without a taper. Multiply the rotary's Y scale by it. */
export function rotaryTaperYFactorAt(profile: RotaryTaperProfile | undefined, x: number): number {
  if (profile === undefined) return 1;
  return profile.referenceRadiusMm / rotaryTaperRadiusAt(profile, x);
}

/** One design point through the warp. */
export function warpRotaryTaperPoint(profile: RotaryTaperProfile, point: Vec2): Vec2 {
  const factor = rotaryTaperYFactorAt(profile, point.x);
  return { x: point.x, y: profile.baseY + (point.y - profile.baseY) * factor };
}

/** The inverse, for a warped point shown back on the design. */
export function restoreRotaryTaperPoint(profile: RotaryTaperProfile, point: Vec2): Vec2 {
  const factor = rotaryTaperYFactorAt(profile, point.x);
  return { x: point.x, y: profile.baseY + (point.y - profile.baseY) / factor };
}

type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** A warped box's bounds: the factor is monotone in X, so its corners bound it. */
export function warpRotaryTaperBounds<T extends Box>(profile: RotaryTaperProfile, bounds: T): T {
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const x of [bounds.minX, bounds.maxX]) {
    for (const y of [bounds.minY, bounds.maxY]) {
      const warped = warpRotaryTaperPoint(profile, { x, y }).y;
      minY = Math.min(minY, warped);
      maxY = Math.max(maxY, warped);
    }
  }
  return { ...bounds, minY, maxY };
}
