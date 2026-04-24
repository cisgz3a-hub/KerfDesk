/**
 * === FILE: /src/core/types.ts ===
 * 
 * Purpose:    Shared primitive types used across all modules.
 *             Every other file in the system depends on these.
 * Dependencies: None (leaf module)
 * Last updated: Phase 1, Step 1 — Foundation
 */

// ─── GEOMETRY PRIMITIVES ─────────────────────────────────────────

export interface Point {
  x: number;
  y: number;
}

export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 3x2 affine transformation matrix.
 * Represents: [a  c  tx]
 *             [b  d  ty]
 *             [0  0   1]
 * 
 * Used for position, rotation, scale, and skew of every scene object.
 */
export interface Matrix3x2 {
  a: number;   // scale X / rotation
  b: number;   // skew Y
  c: number;   // skew X
  d: number;   // scale Y / rotation
  tx: number;  // translate X
  ty: number;  // translate Y
}

/** Identity matrix — no transformation */
export const IDENTITY_MATRIX: Readonly<Matrix3x2> = {
  a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0,
};

// ─── ID GENERATION ───────────────────────────────────────────────

let _randCounter = 0;
let _detCounter = 0;

/**
 * When true, {@link generateId} returns `det-000001`, `det-000002`, ... so
 * tests (E2E gcode snapshots, etc.) are stable. Re-evaluated each call so
 * unit tests can toggle the env or global per case.
 */
function isDeterministic(): boolean {
  if (
    typeof process !== 'undefined' &&
    process.env?.LASERFORGE_DETERMINISTIC_IDS === '1'
  ) {
    return true;
  }
  if (typeof globalThis !== 'undefined') {
    return (globalThis as { __LF_DETERMINISTIC_IDS__?: boolean })
      .__LF_DETERMINISTIC_IDS__ === true;
  }
  return false;
}

/** Reset the sequence used when {@link isDeterministic} is true (e.g. start of each e2e test). */
export function resetDeterministicCounter(): void {
  _detCounter = 0;
}

export function generateId(): string {
  if (isDeterministic()) {
    _detCounter += 1;
    return `det-${String(_detCounter).padStart(6, '0')}`;
  }
  _randCounter++;
  return `${Date.now().toString(36)}-${_randCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// ─── AABB UTILITIES ──────────────────────────────────────────────

export function emptyAABB(): AABB {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function expandAABB(aabb: AABB, x: number, y: number): AABB {
  return {
    minX: Math.min(aabb.minX, x),
    minY: Math.min(aabb.minY, y),
    maxX: Math.max(aabb.maxX, x),
    maxY: Math.max(aabb.maxY, y),
  };
}

export function mergeAABB(a: AABB, b: AABB): AABB {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function aabbWidth(aabb: AABB): number {
  return aabb.maxX - aabb.minX;
}

export function aabbHeight(aabb: AABB): number {
  return aabb.maxY - aabb.minY;
}

export function aabbContainsPoint(aabb: AABB, p: Point): boolean {
  return p.x >= aabb.minX && p.x <= aabb.maxX && p.y >= aabb.minY && p.y <= aabb.maxY;
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// ─── UNIT TYPES ──────────────────────────────────────────────────

export type Units = 'mm' | 'inch';
export type Origin = 'top-left' | 'bottom-left' | 'center';

// ─── MACHINE LIMITS ─────────────────────────────────────────────

/** Maximum allowed laser feed rate (mm/min). GRBL caps via $110/$111; we clamp in UI and compiler for consistent estimates. */
export const MAX_LASER_SPEED = 10000;

/** Minimum allowed laser feed rate (mm/min). */
export const MIN_LASER_SPEED = 1;

// ─── RESULT TYPE ─────────────────────────────────────────────────

export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };
