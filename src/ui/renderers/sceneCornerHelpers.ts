/**
 * T1-138: pure local-space corner-points helper extracted from
 * `SceneRenderer.getLocalCorners`. Used by the fill-preview renderer
 * (`drawFillPreview`) to compute a local AABB before scan-converting
 * a fill pattern. The set of "corners" varies by geometry type:
 *
 *   - rect       → two opposite corners
 *   - ellipse    → AABB corners derived from cx/cy ± rx/ry
 *   - polygon    → all polygon vertices
 *   - path       → every endpoint AND every control point (so the
 *                  AABB conservatively contains every curve's
 *                  bounding box, even though it overestimates)
 *   - line/text/image → not used by the fill preview, returns []
 *
 * Pre-T1-138 this 27-line switch lived inside SceneRenderer.ts;
 * exercising it required loading the renderer module's
 * canvas/Image/IDB dependencies. Post-T1-138 it's a pure function
 * over `Geometry`.
 */
import type { Geometry } from '../../core/scene/SceneObject';

/**
 * Return the local-space points that drive the fill-preview AABB for
 * the given geometry. For `path` types this returns endpoints AND
 * control points (not the true curve extrema) — the same conservative
 * approximation the pre-T1-138 inline code used.
 *
 * Returns `[]` for geometries that the fill renderer doesn't support
 * (line / text / image) so the caller's `length === 0` guard kicks in.
 */
export function getSceneObjectLocalCorners(geom: Geometry): Array<{ x: number; y: number }> {
  switch (geom.type) {
    case 'rect':
      return [
        { x: geom.x, y: geom.y },
        { x: geom.x + geom.width, y: geom.y + geom.height },
      ];
    case 'ellipse':
      return [
        { x: geom.cx - geom.rx, y: geom.cy - geom.ry },
        { x: geom.cx + geom.rx, y: geom.cy + geom.ry },
      ];
    case 'polygon': return geom.points;
    case 'path': {
      const pts: Array<{ x: number; y: number }> = [];
      for (const sub of geom.subPaths) {
        for (const seg of sub.segments) {
          if (seg.type === 'move' || seg.type === 'line') pts.push(seg.to);
          else if (seg.type === 'cubic') { pts.push(seg.cp1); pts.push(seg.cp2); pts.push(seg.to); }
          else if (seg.type === 'quadratic') { pts.push(seg.cp); pts.push(seg.to); }
        }
      }
      return pts;
    }
    default: return [];
  }
}
