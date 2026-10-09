import type { ConstrainedSketch2d, SketchConstraint } from './constrained-sketch';
import { sketchLength, resolveSketchParameters } from './sketch-parameters';
import { sketchAt, sketchRequired } from './sketch-indexed';
import type { SketchEvaluator, SketchResidual, SketchDerivative } from './sketch-jacobian';
import { sketchConstraintJacobian } from './sketch-constraint-jacobian';
type Pair = readonly [number, number];
type EquationContext = {
  readonly point: (id: string, values: readonly number[]) => Pair;
  readonly line: (id: string, values: readonly number[]) => Pair;
  readonly radius: (id: string, values: readonly number[]) => number;
  readonly length: (
    value: Extract<SketchConstraint, { readonly value: unknown }>['value'],
  ) => number;
};
export function sketchEquations(sketch: ConstrainedSketch2d):
  | {
      readonly kind: 'ok';
      readonly initial: readonly number[];
      readonly evaluate: SketchEvaluator;
      readonly derivative: SketchDerivative;
    }
  | { readonly kind: 'error'; readonly reason: string } {
  const parameters = resolveSketchParameters(sketch.parameters);
  if (parameters.kind === 'error') return parameters;
  const points = new Map(sketch.points.map((point, index) => [point.id, index * 2]));
  const circles = new Map(
    sketch.circles.map((circle, index) => [circle.id, sketch.points.length * 2 + index]),
  );
  const point = (id: string, values: readonly number[]): Pair => {
    const index = sketchRequired(points.get(id), 'point ' + id);
    return [sketchAt(values, index), sketchAt(values, index + 1)];
  };
  const context: EquationContext = {
    point,
    line: (id, values) => {
      const entity = sketchRequired(
          sketch.lines.find((item) => item.id === id),
          'line ' + id,
        ),
        a = point(entity.first, values),
        b = point(entity.second, values);
      return [b[0] - a[0], b[1] - a[1]];
    },
    radius: (id, values) => sketchAt(values, sketchRequired(circles.get(id), 'circle ' + id)),
    length: (value) => sketchLength(value, parameters.values),
  };
  try {
    for (const constraint of sketch.constraints)
      if ('value' in constraint) {
        const length = context.length(constraint.value);
        if ((constraint.kind === 'distance' || constraint.kind === 'diameter') && length <= 0)
          throw new Error(constraint.id + ' needs a positive dimension.');
      }
    return {
      kind: 'ok',
      initial: [
        ...sketch.points.flatMap((point) => [point.x, point.y]),
        ...sketch.circles.map((circle) => circle.radiusMm),
      ],
      derivative: (values) => sketchConstraintJacobian(sketch, values),
      evaluate: (values) =>
        sketch.constraints.flatMap((constraint) => constraintResidual(constraint, values, context)),
    };
  } catch (error) {
    return { kind: 'error', reason: error instanceof Error ? error.message : String(error) };
  }
}
function constraintResidual(
  constraint: SketchConstraint,
  values: readonly number[],
  context: EquationContext,
): readonly SketchResidual[] {
  const { id } = constraint;
  switch (constraint.kind) {
    case 'x':
    case 'y':
      return [
        {
          id,
          value:
            context.point(constraint.pointId, values)[constraint.kind === 'x' ? 0 : 1] -
            context.length(constraint.value),
        },
      ];
    case 'coincident': {
      const a = context.point(constraint.first, values),
        b = context.point(constraint.second, values);
      return [
        { id, value: a[0] - b[0] },
        { id, value: a[1] - b[1] },
      ];
    }
    case 'horizontal':
    case 'vertical':
      return [
        {
          id,
          value: context.line(constraint.lineId, values)[constraint.kind === 'horizontal' ? 1 : 0],
        },
      ];
    case 'distance': {
      const a = context.point(constraint.first, values),
        b = context.point(constraint.second, values);
      return [
        { id, value: Math.hypot(a[0] - b[0], a[1] - b[1]) - context.length(constraint.value) },
      ];
    }
    case 'equal':
      return [
        {
          id,
          value:
            Math.hypot(...context.line(constraint.firstLineId, values)) -
            Math.hypot(...context.line(constraint.secondLineId, values)),
        },
      ];
    case 'diameter':
      return [
        {
          id,
          value: 2 * context.radius(constraint.circleId, values) - context.length(constraint.value),
        },
      ];
  }
}
