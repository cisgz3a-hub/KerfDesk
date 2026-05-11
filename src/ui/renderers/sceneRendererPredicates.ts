/**
 * T1-146: pure predicates + color mapping extracted from SceneRenderer.
 * These three sanity-checks and one color lookup were inline helpers
 * in the 1245-line renderer file. They are pure (no `this`, no canvas
 * mutation) but mixed in with side-effecty draw functions, so the
 * import surface was hard to test against.
 *
 *   - `isCurrentTransformFinite(ctx)`: checks the canvas's current
 *     transform matrix for NaN/Infinity. Used as a defensive guard
 *     after `applyToContext` — when this returns false the renderer
 *     bails out of the draw pass and logs a console error rather
 *     than producing undefined-coordinate stroke calls.
 *   - `isRenderableAabb(b)`: checks an `AABB` is finite AND has
 *     positive area. Used to skip empty / collapsed bounds before
 *     scissoring / clipping.
 *   - `isSafeObjectMatrix(t)`: checks a 2D affine transform's six
 *     fields are all finite. Object renderer uses this to skip
 *     objects whose transform contains NaN.
 *   - `previewStrokeForMode(mode)`: pure color lookup for the
 *     UI-visible preview stroke (cut → red, engrave → cyan, score →
 *     mint, image → muted gray). The colors are part of the user
 *     surface — verbatim contract.
 */
import type { AABB, Matrix3x2 } from '../../core/types';
import type { LayerMode } from '../../core/scene/Layer';

export function isCurrentTransformFinite(ctx: CanvasRenderingContext2D): boolean {
  const m = ctx.getTransform();
  return (
    Number.isFinite(m.a) && Number.isFinite(m.b)
    && Number.isFinite(m.c) && Number.isFinite(m.d)
    && Number.isFinite(m.e) && Number.isFinite(m.f)
  );
}

export function isRenderableAabb(b: AABB): boolean {
  return (
    Number.isFinite(b.minX) && Number.isFinite(b.maxX)
    && Number.isFinite(b.minY) && Number.isFinite(b.maxY)
    && b.maxX > b.minX && b.maxY > b.minY
  );
}

export function isSafeObjectMatrix(t: Matrix3x2): boolean {
  return [t.a, t.b, t.c, t.d, t.tx, t.ty].every(Number.isFinite);
}

/**
 * UI-visible preview stroke color for a layer mode. Pinned values:
 *   - cut     → '#ff4466' (red-pink)
 *   - engrave → '#00d4ff' (cyan)
 *   - score   → '#2dd4a0' (mint)
 *   - image   → '#8888aa' (muted gray)
 *   - default → '#8888aa' (same as image — defensive fallback)
 */
export function previewStrokeForMode(mode: LayerMode): string {
  if (mode === 'cut') return '#ff4466';
  if (mode === 'engrave') return '#00d4ff';
  if (mode === 'score') return '#2dd4a0';
  if (mode === 'image') return '#8888aa';
  return '#8888aa';
}
