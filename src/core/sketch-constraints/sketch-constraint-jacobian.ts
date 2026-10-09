import type { ConstrainedSketch2d } from './constrained-sketch';
import { sketchAt, sketchRequired } from './sketch-indexed';

type Pair = readonly [number, number];
/** Exact endpoint derivatives preserve rigid translation, including at a collapsed start. */
export function sketchConstraintJacobian(
  sketch: ConstrainedSketch2d,
  values: readonly number[],
): number[][] {
  const indices = new Map(sketch.points.map((point, index) => [point.id, index * 2]));
  const lines = new Map(sketch.lines.map((entity) => [entity.id, entity]));
  const circles = new Map(
    sketch.circles.map((circle, index) => [circle.id, sketch.points.length * 2 + index]),
  );
  const row = (): number[] => Array<number>(values.length).fill(0);
  const coordinate = (point: string, axis: number): number =>
    sketchRequired(indices.get(point), 'point ' + point) + axis;
  const add = (target: number[], index: number, value: number): void => {
    target[index] = sketchAt(target, index) + value;
  };
  const points = (target: number[], first: string, second: string, direction: Pair): void => {
    for (let axis = 0; axis < 2; axis += 1) {
      add(target, coordinate(first, axis), -sketchAt(direction, axis));
      add(target, coordinate(second, axis), sketchAt(direction, axis));
    }
  };
  const direction = (first: string, second: string): Pair => {
    const x = sketchAt(values, coordinate(second, 0)) - sketchAt(values, coordinate(first, 0));
    const y = sketchAt(values, coordinate(second, 1)) - sketchAt(values, coordinate(first, 1));
    const length = Math.hypot(x, y);
    // A norm has no unique derivative at zero. An opposite endpoint direction lets a
    // positive dimension open the segment without translating it. Both axes are used
    // so horizontal or vertical relations can retain their permitted direction.
    return length === 0 ? [Math.SQRT1_2, Math.SQRT1_2] : [x / length, y / length];
  };
  const line = (id: string) => sketchRequired(lines.get(id), 'line ' + id);
  return sketch.constraints.flatMap((constraint) => {
    const current = row();
    switch (constraint.kind) {
      case 'x':
      case 'y':
        add(current, coordinate(constraint.pointId, constraint.kind === 'x' ? 0 : 1), 1);
        return [current];
      case 'coincident': {
        const vertical = row();
        points(current, constraint.first, constraint.second, [-1, 0]);
        points(vertical, constraint.first, constraint.second, [0, -1]);
        return [current, vertical];
      }
      case 'horizontal':
      case 'vertical': {
        const entity = line(constraint.lineId);
        points(
          current,
          entity.first,
          entity.second,
          constraint.kind === 'horizontal' ? [0, 1] : [1, 0],
        );
        return [current];
      }
      case 'distance':
        points(
          current,
          constraint.first,
          constraint.second,
          direction(constraint.first, constraint.second),
        );
        return [current];
      case 'equal': {
        const first = line(constraint.firstLineId);
        const second = line(constraint.secondLineId);
        points(current, first.first, first.second, direction(first.first, first.second));
        const secondDirection = direction(second.first, second.second);
        points(current, second.first, second.second, [-secondDirection[0], -secondDirection[1]]);
        return [current];
      }
      case 'diameter':
        add(
          current,
          sketchRequired(circles.get(constraint.circleId), 'circle ' + constraint.circleId),
          2,
        );
        return [current];
    }
  });
}
