import {
  assertRampPointCount,
  rampCapacities,
  rampDepth,
  rampSegmentEndFraction,
  rampZ,
} from '../cnc/contour-ramp-precision';
import type { Vec3 } from '../geometry/vec3';
import type { Vec2 } from '../scene';

type LoopPoint = { readonly segment: number; readonly point: Vec2; readonly distance: number };
type Ramp = { readonly points: ReadonlyArray<Vec3>; readonly end: LoopPoint };

/** Budget descent in emitted coordinates while retaining the heightmap loop and seam. */
export function reliefRampAlong(
  points: ReadonlyArray<Vec2>,
  start: LoopPoint,
  fromZ: number,
  toZ: number,
  tangent: number,
  place: (point: Vec2) => Vec2,
): Ramp | null {
  const depth = rampDepth(fromZ, toZ);
  if (depth === null) return null;
  if (depth.dropQuanta <= 0) return { points: [], end: start };
  const walk = [start.point];
  for (let step = 1; step <= points.length; step += 1) {
    walk.push(points[(start.segment + step) % points.length] as Vec2);
  }
  walk.push(start.point);
  const placed = walk.map(place);
  const capacities = rampCapacities(placed, tangent, depth.dropQuanta);
  const capacity = capacities.reduce((sum, value) => sum + value, 0);
  if (!(capacity > 0)) return null;
  const laps = Math.ceil(depth.dropQuanta / capacity);
  assertRampPointCount(laps * (walk.length - 1) + 1);
  const out: Vec3[] = [{ ...start.point, z: rampZ(depth.fromQuanta) }];
  let remaining = depth.dropQuanta;
  for (let lap = 0; lap < laps; lap += 1) {
    for (let index = 1; index < walk.length; index += 1) {
      const a = walk[index - 1] as Vec2;
      const b = walk[index] as Vec2;
      const step = capacities[index - 1] ?? 0;
      if (step >= remaining) {
        const fraction = rampSegmentEndFraction(
          placed[index - 1] as Vec2,
          placed[index] as Vec2,
          tangent,
          remaining,
        );
        const end = { x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction };
        out.push({ ...end, z: rampZ(depth.targetQuanta) });
        return {
          points: out,
          end: { segment: (start.segment + index - 1) % points.length, point: end, distance: 0 },
        };
      }
      remaining -= step;
      out.push({ ...b, z: rampZ(depth.targetQuanta + remaining) });
    }
  }
  throw new RangeError('Relief ramp descent cannot be represented at coordinate precision.');
}
