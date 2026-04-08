/**
 * === FILE: /src/io/SvgImportPlacement.ts ===
 *
 * Purpose:    Pure math for positioning and scaling imported content
 *             within a target area. Computes a single Matrix3x2 that
 *             centers and optionally scales imported objects.
 *
 *             Three modes:
 *             - 'original': no scaling, centered in target
 *             - 'fit':      scale to fit inside target (no overflow)
 *             - 'fill':     scale to fill target (may crop)
 *
 * Dependencies:
 *   - /src/core/types.ts (Matrix3x2, AABB, Point)
 *   - /src/core/scene/SceneObject.ts
 *   - /src/import/svg/TransformParser.ts (multiplyMatrix)
 * Last updated: SVG Import Placement feature
 */

import { type Matrix3x2, type AABB, IDENTITY_MATRIX } from '../core/types';
import { type SceneObject } from '../core/scene/SceneObject';
import { multiplyMatrix } from '../import/svg/TransformParser';

// ─── OPTIONS ─────────────────────────────────────────────────────

export interface ImportOptions {
  /** Scaling mode: 'original' (no scale), 'fit' (inside), 'fill' (cover) */
  mode: 'original' | 'fit' | 'fill';
  /** Target area to position within. Defaults to scene canvas bounds. */
  targetBounds?: AABB;
  /** Padding as fraction (0.1 = 10% inset). Default 0.1. */
  padding?: number;
  /** Maintain aspect ratio when scaling. Default true. */
  preserveAspect?: boolean;
  /** Allow scaling up content smaller than target. Default false.
   *  false = shrink if too big, leave alone if small (safe import)
   *  true  = always scale to match target (fit-to-canvas) */
  allowScaleUp?: boolean;
}

const DEFAULT_OPTIONS: Required<ImportOptions> = {
  mode: 'fit',
  targetBounds: { minX: 0, minY: 0, maxX: 400, maxY: 400 },
  padding: 0.1,
  preserveAspect: true,
  allowScaleUp: false,
};

// ─── COMPUTE IMPORT TRANSFORM ────────────────────────────────────

/**
 * Compute a Matrix3x2 that positions and scales source content
 * within a target area.
 *
 * The transform is: translate(center) × scale × translate(-sourceCenter)
 *
 * @param sourceBounds  AABB of the imported content
 * @param targetBounds  AABB to place content within
 * @param options       Scaling mode, padding, aspect ratio
 * @returns             Transform matrix to apply to imported objects
 */
export function computeImportTransform(
  sourceBounds: AABB,
  targetBounds: AABB,
  options: Partial<ImportOptions> = {}
): Matrix3x2 {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const srcW = sourceBounds.maxX - sourceBounds.minX;
  const srcH = sourceBounds.maxY - sourceBounds.minY;

  // Degenerate: empty source → identity (nothing to transform)
  if (srcW <= 0 || srcH <= 0) return { ...IDENTITY_MATRIX };

  const tgtW = targetBounds.maxX - targetBounds.minX;
  const tgtH = targetBounds.maxY - targetBounds.minY;

  if (tgtW <= 0 || tgtH <= 0) return { ...IDENTITY_MATRIX };

  // Source and target centers
  const srcCx = sourceBounds.minX + srcW / 2;
  const srcCy = sourceBounds.minY + srcH / 2;
  const tgtCx = targetBounds.minX + tgtW / 2;
  const tgtCy = targetBounds.minY + tgtH / 2;

  // Compute scale
  let sx: number, sy: number;

  if (opts.mode === 'original') {
    sx = 1;
    sy = 1;
  } else {
    // Available space after padding
    const pad = Math.max(0, Math.min(0.49, opts.padding));
    const availW = tgtW * (1 - 2 * pad);
    const availH = tgtH * (1 - 2 * pad);

    const rawSx = availW / srcW;
    const rawSy = availH / srcH;

    if (opts.preserveAspect) {
      const uniformScale = opts.mode === 'fit'
        ? Math.min(rawSx, rawSy)
        : Math.max(rawSx, rawSy);  // 'fill'
      sx = uniformScale;
      sy = uniformScale;
    } else {
      sx = rawSx;
      sy = rawSy;
    }

    // Cap at 1.0 unless explicitly allowed to scale up
    if (!opts.allowScaleUp) {
      sx = Math.min(sx, 1);
      sy = Math.min(sy, 1);
    }
  }

  // Combined matrix: translate(tgtCenter) × scale × translate(-srcCenter)
  // = { a: sx, d: sy, tx: tgtCx - srcCx*sx, ty: tgtCy - srcCy*sy }
  return {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    tx: tgtCx - srcCx * sx,
    ty: tgtCy - srcCy * sy,
  };
}

// ─── APPLY TRANSFORM TO OBJECTS ──────────────────────────────────

/**
 * Apply a transform to a list of objects by composing it into each
 * object's existing transform. Returns new objects — never mutates.
 *
 * The import transform is pre-multiplied: importT × objectT
 * This means the import transform applies first in world space.
 */
export function applyTransformToObjects(
  objects: ReadonlyArray<SceneObject>,
  transform: Matrix3x2
): SceneObject[] {
  // Identity check: skip allocation if transform is identity
  if (transform.a === 1 && transform.b === 0 &&
      transform.c === 0 && transform.d === 1 &&
      transform.tx === 0 && transform.ty === 0) {
    return [...objects];
  }

  return objects.map(obj => ({
    ...obj,
    transform: multiplyMatrix(transform, obj.transform),
    _bounds: null,
    _worldTransform: null,
  }));
}
