// G-code as editable artwork (LightBurn imports G-code files as shapes). The
// cutting moves of a parsed program, laser-on or below the surface, become
// polylines: consecutive cuts that meet join into one line, any travel or gap
// starts a new one, and a line that returns to its start is closed. Arcs are
// already broken into short lines by the render model. Coordinates go through
// the caller's machine-to-scene mapping, so the artwork lands where the
// program would cut on this machine's bed.

import type { Polyline, Vec2 } from '../scene';
import { SEG_KIND, type GcodeRenderModel } from './render-model-types';

const JOIN_EPS_MM = 1e-4;

export function gcodeCutPolylines(
  model: Pick<GcodeRenderModel, 'segmentCount' | 'positions' | 'segKind'>,
  toScene: (machine: Vec2) => Vec2,
): ReadonlyArray<Polyline> {
  const lines: Polyline[] = [];
  let current: Vec2[] = [];
  let end: Vec2 | null = null;
  const flush = (): void => {
    if (current.length >= 2) lines.push(finished(current));
    current = [];
    end = null;
  };
  for (let index = 0; index < model.segmentCount; index += 1) {
    if (model.segKind[index] !== SEG_KIND.cut) {
      flush();
      continue;
    }
    const at = index * 6;
    const from = { x: model.positions[at] ?? 0, y: model.positions[at + 1] ?? 0 };
    const to = { x: model.positions[at + 3] ?? 0, y: model.positions[at + 4] ?? 0 };
    if (Math.hypot(to.x - from.x, to.y - from.y) < JOIN_EPS_MM) continue;
    if (end === null || Math.hypot(from.x - end.x, from.y - end.y) > JOIN_EPS_MM) {
      flush();
      current.push(toScene(from));
    }
    current.push(toScene(to));
    end = to;
  }
  flush();
  return lines;
}

function finished(points: Vec2[]): Polyline {
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  const closed = points.length > 2 && Math.hypot(last.x - first.x, last.y - first.y) <= JOIN_EPS_MM;
  return { points: closed ? [...points.slice(0, -1), first] : points, closed };
}
