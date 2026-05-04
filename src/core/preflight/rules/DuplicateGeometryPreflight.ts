/**
 * T2-16: duplicate / overlap path detection in preflight.
 *
 * Real-world failure modes:
 *   - User imports an SVG that has two stacked copies of the same logo
 *     (Inkscape "duplicate-and-modify" workflows where the original
 *     wasn't removed).
 *   - User pastes a shape and forgets they had a copy already.
 *   - Multiple imports of the same template.
 *
 * Without detection, the controller burns each duplicate independently —
 * twice the time, twice the power deposited per pixel, charred edges,
 * wasted material.
 *
 * Severity is **warning** (not error) because users sometimes
 * intentionally stack shapes (double cuts, power doubling). Block would
 * be too aggressive; the warning surfaces the suspicion and the user
 * confirms or removes.
 *
 * **Fingerprint shape:** the canonical-form key collapses two objects
 * into the same bucket when they are visually indistinguishable on the
 * canvas:
 *
 *   type | rounded(transform: a,b,c,d,tx,ty) | geometry signature
 *
 * Transform fields are rounded to 0.001 (1 µm) before hashing — that's
 * tighter than any realistic mechanical tolerance and avoids false
 * positives from floating-point noise. Different rotation / scale →
 * different a/b/c/d → different fingerprint. Different position →
 * different tx/ty.
 *
 * Geometry signature is per-type:
 *   - rect: width, height, cornerRadius
 *   - ellipse: rx, ry
 *   - line: dx, dy (length+direction; absolute coords are in transform)
 *   - polygon: point count + closed flag + first 3 points (cheap shape disambiguation)
 *   - path: subPath count + total segment count + first move-to coords
 *   - text: full text + font family + font size + style flags
 *   - image: imageRef src + bitmap width/height
 *   - group: child count (groups rarely duplicate cleanly; conservative)
 *
 * Trade-off: this catches the spec's "stacked-duplicate logo" case
 * exactly (transform identical, geometry identical → bucket collision)
 * while avoiding false positives on shapes that happen to share a
 * bounding box (a 50×50 square and a 50-radius circle both fit a
 * 50×50 box but have different geometry signatures and different types).
 */
import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import type { SceneObject } from '../../scene/SceneObject';

const ROUND = 1000; // 0.001 = 1 µm

function roundToMicron(n: number): number {
  return Math.round(n * ROUND) / ROUND;
}

/**
 * Produce a stable canonical-form key for a SceneObject. Two objects that
 * would render visually identical on the canvas produce equal keys.
 */
export function fingerprintObject(obj: SceneObject): string {
  const t = obj.transform;
  const transformKey = [
    roundToMicron(t.a),
    roundToMicron(t.b),
    roundToMicron(t.c),
    roundToMicron(t.d),
    roundToMicron(t.tx),
    roundToMicron(t.ty),
  ].join(',');

  const g = obj.geometry;
  let geomKey: string;
  switch (g.type) {
    case 'rect':
      geomKey = `rect:${roundToMicron(g.width)}x${roundToMicron(g.height)}r${roundToMicron(g.cornerRadius)}`;
      break;
    case 'ellipse':
      geomKey = `ell:${roundToMicron(g.rx)}x${roundToMicron(g.ry)}`;
      break;
    case 'line':
      geomKey = `line:${roundToMicron(g.x2 - g.x1)},${roundToMicron(g.y2 - g.y1)}`;
      break;
    case 'polygon': {
      const head = g.points.slice(0, 3)
        .map(p => `${roundToMicron(p.x)},${roundToMicron(p.y)}`)
        .join(';');
      geomKey = `poly:${g.points.length}c${g.closed ? 1 : 0}@${head}`;
      break;
    }
    case 'path': {
      let totalSegments = 0;
      for (const sp of g.subPaths) totalSegments += sp.segments.length;
      const firstSubPath = g.subPaths[0];
      const firstSeg = firstSubPath?.segments[0];
      const firstPoint = firstSeg && firstSeg.type === 'move'
        ? `${roundToMicron(firstSeg.to.x)},${roundToMicron(firstSeg.to.y)}`
        : '_';
      geomKey = `path:${g.subPaths.length}sp/${totalSegments}seg@${firstPoint}`;
      break;
    }
    case 'text':
      geomKey = `txt:${g.text}|${g.fontFamily}|${roundToMicron(g.fontSize)}|${g.bold ? 'b' : ''}${g.italic ? 'i' : ''}`;
      break;
    case 'image':
      geomKey = `img:${(g as { src?: string }).src ?? 'inline'}|${roundToMicron((g as { width?: number }).width ?? 0)}x${roundToMicron((g as { height?: number }).height ?? 0)}`;
      break;
    default: {
      // Exhaustive switch over Geometry union; if a new variant is
      // added the type system flags this default branch.
      // Note: SceneObject.type can be 'group' but Geometry doesn't
      // include a Group variant — group objects compose children
      // rather than carrying their own geometry, so they never
      // reach this switch via a meaningful geometry shape.
      const _exhaustive: never = g;
      void _exhaustive;
      geomKey = 'unknown';
    }
  }

  return `${obj.type}|${transformKey}|${geomKey}`;
}

export function runDuplicateGeometryChecks(
  ctx: PreflightContext,
  out: PreflightResult[],
): void {
  const fingerprints = new Map<string, string[]>();

  for (const obj of ctx.scene.objects) {
    if (!obj.visible) continue;
    // Skip layers that won't be output anyway — duplicates on a
    // hidden / output:false layer don't burn twice and aren't worth
    // surfacing.
    const layer = ctx.scene.layers.find(l => l.id === obj.layerId);
    if (layer && (!layer.visible || layer.output === false)) continue;

    const fp = fingerprintObject(obj);
    const existing = fingerprints.get(fp);
    if (existing) {
      existing.push(obj.id);
    } else {
      fingerprints.set(fp, [obj.id]);
    }
  }

  for (const ids of fingerprints.values()) {
    if (ids.length < 2) continue;
    // Single warning per duplicate cluster, not one per pair. The
    // user inspects the canvas; "5 stacked copies" is the headline,
    // not "10 pairs."
    const sample = ids.slice(0, 3).join(', ');
    const more = ids.length > 3 ? `, +${ids.length - 3} more` : '';
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.GEOMETRY_DUPLICATE,
      message:
        `${ids.length} potentially duplicate objects detected (${sample}${more}). ` +
        'They share the same transform and geometry shape and will burn ' +
        'multiple times if intentional. Inspect the canvas — delete duplicates ' +
        'if unintended, or confirm to proceed.',
    });
  }
}
