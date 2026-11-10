// typed-entry — what a typed number does to a live draw gesture (ADR-272
// Amendment 5, Phase N DS-3c).
//
// A typed value is a LOCK, not a replacement for the pointer: the pointer keeps
// supplying every quantity the operator has not typed, so "50" Enter on a line
// draws 50 mm toward wherever the cursor points, and "50" Tab "30" Enter draws
// it at exactly 30 degrees whatever the cursor does. That is the AutoCAD
// dynamic-input and Fusion sketch-entry contract, and it is why the locks are
// applied when the gesture is READ rather than baked into the stored pointer:
// moving the mouse after typing still steers the free quantities.
//
// Angles use the convention the draft readout already prints
// (atan2(dy, dx) in sketch millimetres), so typing the number the canvas shows
// reproduces the line the canvas shows.

import type { Vec2 } from '../../scene';
import { evaluateNumericEntry } from '../../numeric-expression';

export type EntryLockKey = 'length' | 'angle' | 'width' | 'height' | 'radius' | 'sweep';

export type EntryLocks = Readonly<Partial<Record<EntryLockKey, number>>>;

export const NO_ENTRY_LOCKS: EntryLocks = {};

const DEG_TO_RAD = Math.PI / 180;
const FULL_TURN_DEG = 360;

export function hasEntryLocks(locks: EntryLocks | undefined): boolean {
  return locks !== undefined && Object.keys(locks).length > 0;
}

/**
 * The point `target` becomes once a typed length and/or angle are honoured,
 * measured from `anchor`. With an angle locked, the free length is the
 * pointer's projection onto that ray (never behind the anchor). With only a
 * length locked, the pointer keeps the direction; a pointer sitting on the
 * anchor has none, so the length is laid along +X — a typed length must draw
 * something rather than wait for a mouse move.
 */
export function lockPolarPoint(
  anchor: Vec2,
  target: Vec2,
  locks: { readonly lengthMm?: number | undefined; readonly angleDeg?: number | undefined },
): Vec2 {
  const { lengthMm, angleDeg } = locks;
  if (lengthMm === undefined && angleDeg === undefined) return target;
  const dx = target.x - anchor.x;
  const dy = target.y - anchor.y;
  if (angleDeg !== undefined) {
    const ux = Math.cos(angleDeg * DEG_TO_RAD);
    const uy = Math.sin(angleDeg * DEG_TO_RAD);
    const along = lengthMm ?? Math.max(0, dx * ux + dy * uy);
    return { x: anchor.x + ux * along, y: anchor.y + uy * along };
  }
  const reach = Math.hypot(dx, dy);
  const ux = reach > 0 ? dx / reach : 1;
  const uy = reach > 0 ? dy / reach : 0;
  const along = lengthMm ?? reach;
  return { x: anchor.x + ux * along, y: anchor.y + uy * along };
}

/**
 * The arc end a typed sweep names: `startMm` turned about `centerMm` by the
 * sweep. The Studio's arc tool sweeps counter-clockwise in its angle
 * convention, so a negative typed sweep is read as its counter-clockwise
 * equivalent (-90 lands where 270 does) instead of drawing backwards.
 */
export function lockSweepEnd(centerMm: Vec2, startMm: Vec2, sweepDeg: number): Vec2 {
  const radius = Math.hypot(startMm.x - centerMm.x, startMm.y - centerMm.y);
  const startDeg = Math.atan2(startMm.y - centerMm.y, startMm.x - centerMm.x) / DEG_TO_RAD;
  const turned = (((startDeg + sweepDeg) % FULL_TURN_DEG) + FULL_TURN_DEG) % FULL_TURN_DEG;
  return {
    x: centerMm.x + Math.cos(turned * DEG_TO_RAD) * radius,
    y: centerMm.y + Math.sin(turned * DEG_TO_RAD) * radius,
  };
}

export type EntryParse =
  | { readonly kind: 'ok'; readonly value: number }
  | { readonly kind: 'clear' }
  | { readonly kind: 'invalid'; readonly message: string };

/**
 * Reads what the operator typed into one entry box. Lengths accept the same
 * maths and units as every other numeric box (`25.4`, `1in`, `100/3`); a size
 * must be positive because a zero or negative length, width or radius draws
 * nothing. Angles and sweeps take degrees and any sign. An empty box clears the
 * lock so the pointer drives that quantity again.
 */
export function parseEntryValue(key: EntryLockKey, text: string): EntryParse {
  if (text.trim() === '') return { kind: 'clear' };
  const angular = key === 'angle' || key === 'sweep';
  const result = evaluateNumericEntry(text, { kind: angular ? 'angle' : 'length' });
  if (result.kind === 'invalid') return result;
  if (key === 'sweep' && Math.abs(result.value) >= FULL_TURN_DEG) {
    return { kind: 'invalid', message: 'a sweep must be under 360°' };
  }
  if (!angular && result.value <= 0) {
    return { kind: 'invalid', message: 'a size must be greater than zero' };
  }
  return { kind: 'ok', value: result.value };
}

/** The lock set with one key set, or removed when `value` is null. */
export function withEntryLock(
  locks: EntryLocks | undefined,
  key: EntryLockKey,
  value: number | null,
): EntryLocks {
  const kept = Object.entries(locks ?? NO_ENTRY_LOCKS).filter(([existing]) => existing !== key);
  const next: Partial<Record<EntryLockKey, number>> = Object.fromEntries(kept);
  if (value !== null) next[key] = value;
  return next;
}
