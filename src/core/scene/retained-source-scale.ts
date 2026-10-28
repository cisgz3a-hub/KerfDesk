// A canvas resize of a retained parametric source (ADR-573 Amendment 1).
//
// A constrained sketch or a generated part keeps its dimensions beside the
// paths they produce. A resize on the canvas only sets the transform scale, so
// those dimensions stopped describing what burns: a bracket resized to W 120
// and then typed to width 80 in its editor burned 160 mm wide. Its editor now
// folds an even resize into the dimensions it shows and regenerates at scale
// 1, as LightBurn pushes a resize back into a shape's own size. A stretch (a
// different factor per axis) cannot be held by dimensions that keep holes
// round, so regenerating removes it and the editor says so beforehand.

import type { Transform } from './scene-object';

export type RetainedSourceScale =
  | { readonly kind: 'unit' }
  | { readonly kind: 'even'; readonly factor: number }
  | { readonly kind: 'stretched'; readonly x: number; readonly y: number };

// A typed or dragged even resize can leave the two factors a rounding error
// apart; neither difference is a resize anyone could see.
const SCALE_EPSILON = 1e-9;

export function retainedSourceScale(transform: Transform): RetainedSourceScale {
  const x = Math.abs(transform.scaleX);
  const y = Math.abs(transform.scaleY);
  if (!(Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0))
    return { kind: 'stretched', x, y };
  if (Math.abs(x / y - 1) > SCALE_EPSILON) return { kind: 'stretched', x, y };
  return Math.abs(x - 1) <= SCALE_EPSILON ? { kind: 'unit' } : { kind: 'even', factor: x };
}

/** The transform at size 1. Mirroring has its own flags, and a negative scale
 *  keeps its sign, so the outline stays where and how it was turned. */
export function withUnitScale(transform: Transform): Transform {
  const scaleX = transform.scaleX < 0 ? -1 : 1;
  const scaleY = transform.scaleY < 0 ? -1 : 1;
  return transform.scaleX === scaleX && transform.scaleY === scaleY
    ? transform
    : { ...transform, scaleX, scaleY };
}

/** A length times an even resize, kept to 12 significant digits so a folded
 *  60 × 1.1 reads 66 rather than 66.00000000000001. */
export function scaledLengthMm(value: number, factor: number): number {
  return Number((value * factor).toPrecision(12));
}
