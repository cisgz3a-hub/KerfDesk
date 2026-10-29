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

import type { Bounds, Transform } from './scene-object';
import { SKETCH_SOLVE_TOLERANCE_MM } from '../sketch-constraints/sketch-solve-summary';

export type RetainedSourceScale =
  | { readonly kind: 'unit' }
  | { readonly kind: 'even'; readonly factor: number }
  | { readonly kind: 'stretched'; readonly x: number; readonly y: number };

/** A retained source as the canvas holds it: its own size and its resize. */
export type RetainedSourceExtent = {
  readonly bounds: Bounds;
  readonly transform: Transform;
};

// Each factor is a size on the canvas divided by the source's own size, and a
// solved sketch's size is good only to the solver's tolerance (ADR-573
// Amendment 2). So typing W, then H, on a sketch solved from a sub-millimetre
// change leaves the factors up to 4e-8 apart: no resize anyone could see, and
// not a stretch. Two factors are one when they differ by no more than that
// tolerance over each extent. Generated parts are exact, and a difference
// that small is just as invisible on them.
export function retainedSourceScale(source: RetainedSourceExtent): RetainedSourceScale {
  const x = Math.abs(source.transform.scaleX);
  const y = Math.abs(source.transform.scaleY);
  if (!(Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0))
    return { kind: 'stretched', x, y };
  const width = source.bounds.maxX - source.bounds.minX;
  const height = source.bounds.maxY - source.bounds.minY;
  if (Math.abs(x / y - 1) > factorSlack(width) + factorSlack(height))
    return { kind: 'stretched', x, y };
  // The longer side measures its factor more closely, so that one is folded.
  const factor = width >= height ? x : y;
  return Math.abs(factor - 1) <= factorSlack(Math.max(width, height))
    ? { kind: 'unit' }
    : { kind: 'even', factor };
}

// How far a factor measured across `extentMm` can be from the true one. A side
// with no length has no factor to measure, so any resize along it is even.
function factorSlack(extentMm: number): number {
  return extentMm > 0 ? SKETCH_SOLVE_TOLERANCE_MM / extentMm : Number.POSITIVE_INFINITY;
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
