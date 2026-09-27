// Independent sampling of DXF bulge polylines for tests (ADR-452).

import type { Vec2 } from '../scene/scene-object';
import { segmentDistance, type BulgeVertex } from './bulge-rings';

/**
 * Dense points of what the bulges draw, computed independently of the
 * writer: mirror to the Y-up frame, walk each arc from its centre, mirror back.
 */
export function sampleBulges(vertices: ReadonlyArray<BulgeVertex>, closed: boolean): Vec2[] {
  const up = vertices.map((v) => ({ x: v.x, y: -v.y, bulge: v.bulge }));
  const edges = closed ? up.length : up.length - 1;
  const out: Vec2[] = [{ x: (up[0] as BulgeVertex).x, y: (up[0] as BulgeVertex).y }];
  for (let i = 0; i < edges; i += 1) {
    const a = up[i] as BulgeVertex;
    const b = up[(i + 1) % up.length] as BulgeVertex;
    if (a.bulge === 0) {
      out.push({ x: b.x, y: b.y });
      continue;
    }
    const theta = 4 * Math.atan(a.bulge); // signed, CCW positive
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    const radius = chord / (2 * Math.sin(Math.abs(theta) / 2));
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    // Centre is left of a→b for a CCW minor arc.
    const h = (Math.sign(theta) * radius * Math.cos(theta / 2)) / chord;
    const cx = mx - h * (b.y - a.y);
    const cy = my + h * (b.x - a.x);
    const start = Math.atan2(a.y - cy, a.x - cx);
    const steps = Math.max(8, Math.ceil(Math.abs(theta) * 200));
    for (let k = 1; k <= steps; k += 1) {
      const angle = start + (theta * k) / steps;
      out.push({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) });
    }
    out[out.length - 1] = { x: b.x, y: b.y };
  }
  return out.map((p) => ({ x: p.x, y: -p.y }));
}

function oneWay(from: ReadonlyArray<Vec2>, to: ReadonlyArray<Vec2>): number {
  let worst = 0;
  for (const p of from) {
    let best = Infinity;
    for (let i = 1; i < to.length; i += 1) {
      best = Math.min(best, segmentDistance(p, to[i - 1] as Vec2, to[i] as Vec2));
      if (best === 0) break;
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

export function hausdorff(a: ReadonlyArray<Vec2>, b: ReadonlyArray<Vec2>): number {
  return Math.max(oneWay(a, b), oneWay(b, a));
}
