// Moshiboard native units (ADR-705): mils, 1/1000 inch, measured from the
// board's home corner. MeerK40t's MoshiDevice builds its view with
// `View(bedwidth, bedheight, dpi=1000.0)` (meerk40t/moshi/device.py L332 at
// d511944e) and every coordinate goes out as a signed 16-bit value
// (builder.py L356-364), so a position must lie in 0..32767 mils (0..832 mm):
// the builder clamps negatives to 0 (L453-456), which would move a cut, so
// the encoder refuses those instead.

import type { Vec2 } from '../../scene';
import { maxOf, minOf } from '../../util';

export const MM_PER_MIL = 0.0254;
export const MOSHI_MAX_POSITION_MILS = 32767;

export type MoshiPoint = { readonly x: number; readonly y: number };
export type MoshiStep = MoshiPoint & { readonly cut: boolean };
export type MoshiBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function mmToMils(mm: number): number {
  return Math.round(mm / MM_PER_MIL) + 0;
}

export function milsToMm(mils: number): number {
  return mils * MM_PER_MIL;
}

export function toMils(point: Vec2): MoshiPoint {
  return { x: mmToMils(point.x), y: mmToMils(point.y) };
}

export function samePoint(a: MoshiPoint, b: MoshiPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

export function isMoshiPosition(mils: number): boolean {
  return Number.isInteger(mils) && mils >= 0 && mils <= MOSHI_MAX_POSITION_MILS;
}

export function stepBounds(steps: ReadonlyArray<MoshiPoint>): MoshiBounds | null {
  if (steps.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const step of steps) {
    minX = Math.min(minX, step.x);
    minY = Math.min(minY, step.y);
    maxX = Math.max(maxX, step.x);
    maxY = Math.max(maxY, step.y);
  }
  return { minX, minY, maxX, maxY };
}

export function unionMoshiBounds(all: ReadonlyArray<MoshiBounds>): MoshiBounds | null {
  if (all.length === 0) return null;
  return {
    minX: minOf(all.map((b) => b.minX)),
    minY: minOf(all.map((b) => b.minY)),
    maxX: maxOf(all.map((b) => b.maxX)),
    maxY: maxOf(all.map((b) => b.maxY)),
  };
}
