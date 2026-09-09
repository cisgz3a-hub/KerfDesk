import { expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../scene';
import { fixture } from '../../../__fixtures__/centerline-attachments';
import { TRACE_PRESETS } from '../trace-presets';
import { traceImageToColoredPaths } from '../trace-to-paths';

function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dot = (p.x - a.x) * dx + (p.y - a.y) * dy;
  const square = dx * dx + dy * dy;
  if (dot <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
  if (dot >= square) return Math.hypot(p.x - b.x, p.y - b.y);
  return Math.abs(dx * (p.y - a.y) - dy * (p.x - a.x)) / Math.sqrt(square);
}
function attachmentGap(paths: ReadonlyArray<Polyline>): number {
  let gap = Infinity;
  for (const [owner, path] of paths.entries()) {
    if (path.closed) continue;
    for (const point of [path.points[0]!, path.points.at(-1)!]) {
      for (const [target, receiver] of paths.entries()) {
        if (target === owner) continue;
        for (let i = 0; i < receiver.points.length - (receiver.closed ? 0 : 1); i += 1) {
          gap = Math.min(
            gap,
            segmentDistance(
              point,
              receiver.points[i]!,
              receiver.points[(i + 1) % receiver.points.length]!,
            ),
          );
        }
      }
    }
  }
  return gap;
}

it.each(['Y', 'ring_branch'])(
  'keeps the finished %s branch on its receiving path',
  async (name) => {
    const paths = await traceImageToColoredPaths(fixture(name), TRACE_PRESETS.Centerline!);
    expect(attachmentGap(paths.flatMap((path) => path.polylines))).toBeLessThan(1e-11);
    if (name === 'ring_branch') {
      const ring = paths.flatMap((path) => path.polylines).find((path) => path.closed)!;
      expect(ring.points[0]).toEqual(ring.points.at(-1));
    }
  },
);
