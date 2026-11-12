import type { ConstrainedSketch2d } from './constrained-sketch';
import { SKETCH_SOLVE_TOLERANCE_MM } from './sketch-solve-summary';

/** Lines whose two ends meet within the solve tolerance. A horizontal and a
 *  vertical relation on one line, or an equal length to such a line, solve
 *  exactly by shrinking it to a point, so the solve cannot call it a conflict;
 *  the review names it instead (Oracle audit O10-P3-1). */
export function sketchCollapsedLines(sketch: ConstrainedSketch2d): readonly string[] {
  const points = new Map(sketch.points.map((point) => [point.id, point]));
  return sketch.lines
    .filter((line) => {
      const first = points.get(line.first);
      const second = points.get(line.second);
      return (
        first !== undefined &&
        second !== undefined &&
        Math.hypot(second.x - first.x, second.y - first.y) <= SKETCH_SOLVE_TOLERANCE_MM
      );
    })
    .map((line) => line.id);
}
