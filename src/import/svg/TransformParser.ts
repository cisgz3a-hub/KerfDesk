/**
 * === FILE: /src/import/svg/TransformParser.ts ===
 *
 * Purpose:    Parse SVG transform attribute strings into Matrix3x2.
 *             Handles all SVG transform functions:
 *               matrix(a,b,c,d,e,f)
 *               translate(tx[, ty])
 *               scale(sx[, sy])
 *               rotate(angle[, cx, cy])
 *               skewX(angle)
 *               skewY(angle)
 *             Compound transforms are applied left-to-right.
 *
 * Dependencies: /src/core/types.ts
 * Last updated: SVG Import feature
 */

import { type Matrix3x2, IDENTITY_MATRIX } from '../../core/types';

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Parse an SVG transform attribute string into a Matrix3x2.
 * Returns IDENTITY_MATRIX for null/empty input.
 *
 * Examples:
 *   "translate(10, 20)"
 *   "rotate(45) scale(2)"
 *   "matrix(1,0,0,1,100,200)"
 */
export function parseTransform(attr: string | null | undefined): Matrix3x2 {
  if (!attr || attr.trim() === '') return { ...IDENTITY_MATRIX };

  // Extract individual transform functions
  const functions = extractTransformFunctions(attr);
  if (functions.length === 0) return { ...IDENTITY_MATRIX };

  // Apply left-to-right (multiply in order)
  let result: Matrix3x2 = { ...IDENTITY_MATRIX };
  for (const fn of functions) {
    const m = parseSingleTransform(fn.name, fn.args);
    result = multiplyMatrix(result, m);
  }

  return result;
}

/**
 * Multiply two affine matrices: result = a × b.
 * Exported for use in transform accumulation through nested groups.
 */
export function multiplyMatrix(a: Matrix3x2, b: Matrix3x2): Matrix3x2 {
  return {
    a:  a.a * b.a + a.c * b.b,
    b:  a.b * b.a + a.d * b.b,
    c:  a.a * b.c + a.c * b.d,
    d:  a.b * b.c + a.d * b.d,
    tx: a.a * b.tx + a.c * b.ty + a.tx,
    ty: a.b * b.tx + a.d * b.ty + a.ty,
  };
}

// ─── FUNCTION EXTRACTION ─────────────────────────────────────────

interface TransformFn {
  name: string;
  args: number[];
}

/**
 * Extract transform function calls from the attribute string.
 * "translate(10,20) rotate(45)" → [{name:'translate', args:[10,20]}, ...]
 */
function extractTransformFunctions(attr: string): TransformFn[] {
  const results: TransformFn[] = [];
  // Match: functionName(args)
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(attr)) !== null) {
    const name = match[1].toLowerCase();
    const argStr = match[2];
    // Split args on commas or whitespace
    const args = argStr
      .split(/[\s,]+/)
      .filter(s => s.length > 0)
      .map(Number)
      .filter(n => !isNaN(n));

    results.push({ name, args });
  }

  return results;
}

// ─── INDIVIDUAL TRANSFORMS ───────────────────────────────────────

function parseSingleTransform(name: string, args: number[]): Matrix3x2 {
  switch (name) {
    case 'matrix':
      return parseMatrix(args);
    case 'translate':
      return parseTranslate(args);
    case 'scale':
      return parseScale(args);
    case 'rotate':
      return parseRotate(args);
    case 'skewx':
      return parseSkewX(args);
    case 'skewy':
      return parseSkewY(args);
    default:
      return { ...IDENTITY_MATRIX };
  }
}

function parseMatrix(args: number[]): Matrix3x2 {
  if (args.length < 6) return { ...IDENTITY_MATRIX };
  return { a: args[0], b: args[1], c: args[2], d: args[3], tx: args[4], ty: args[5] };
}

function parseTranslate(args: number[]): Matrix3x2 {
  const tx = args[0] || 0;
  const ty = args[1] || 0;  // SVG: ty defaults to 0 if omitted
  return { a: 1, b: 0, c: 0, d: 1, tx, ty };
}

function parseScale(args: number[]): Matrix3x2 {
  const sx = args[0] || 1;
  const sy = args.length >= 2 ? args[1] : sx;  // SVG: sy defaults to sx
  return { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
}

function parseRotate(args: number[]): Matrix3x2 {
  const angleDeg = args[0] || 0;
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  if (args.length >= 3) {
    // rotate(angle, cx, cy): rotate around a point
    const cx = args[1];
    const cy = args[2];
    // Equivalent to: translate(cx,cy) × rotate(angle) × translate(-cx,-cy)
    return {
      a: cos,
      b: sin,
      c: -sin,
      d: cos,
      tx: cx * (1 - cos) + cy * sin,
      ty: cy * (1 - cos) - cx * sin,
    };
  }

  // rotate(angle): rotate around origin
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

function parseSkewX(args: number[]): Matrix3x2 {
  const rad = ((args[0] || 0) * Math.PI) / 180;
  return { a: 1, b: 0, c: Math.tan(rad), d: 1, tx: 0, ty: 0 };
}

function parseSkewY(args: number[]): Matrix3x2 {
  const rad = ((args[0] || 0) * Math.PI) / 180;
  return { a: 1, b: Math.tan(rad), c: 0, d: 1, tx: 0, ty: 0 };
}
