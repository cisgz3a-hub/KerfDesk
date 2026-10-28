// An even canvas resize folded into a sketch's dimensions (ADR-573 Amendment 1).
//
// Every length scales: point positions, circle radii, numeric x/y, distance and
// diameter values, numeric mm parameters, and the mm literals inside parameter
// expressions. Angles, ratios and bare numbers do not. The parameter subset
// refuses a product of two lengths, so every mm quantity is a sum of those
// values times ratios and scales exactly; a ratio of two lengths is unchanged.

import type { ImportedSvg } from '../scene/scene-object';
import { retainedSourceScale, scaledLengthMm } from '../scene/retained-source-scale';
import type {
  ConstrainedSketch2d,
  NamedSketchParameter,
  SketchConstraint,
} from './constrained-sketch';
import { SKETCH_EXPRESSION_TOKEN } from './sketch-parameters';

/** The sketch an editor opens on: an even canvas resize is already in its
 *  dimensions, so the values it shows are the sizes that burn. */
export function editableConstrainedSketch(object: ImportedSvg): ConstrainedSketch2d | undefined {
  const sketch = object.constrainedSketch;
  if (sketch === undefined) return undefined;
  const scale = retainedSourceScale(object.transform);
  return scale.kind === 'even' ? scaleConstrainedSketch(sketch, scale.factor) : sketch;
}

export function scaleConstrainedSketch(
  sketch: ConstrainedSketch2d,
  factor: number,
): ConstrainedSketch2d {
  if (factor === 1) return sketch;
  return {
    ...sketch,
    parameters: sketch.parameters.map((parameter) => scaledParameter(parameter, factor)),
    points: sketch.points.map((point) => ({
      ...point,
      x: scaledLengthMm(point.x, factor),
      y: scaledLengthMm(point.y, factor),
    })),
    circles: sketch.circles.map((circle) => ({
      ...circle,
      radiusMm: scaledLengthMm(circle.radiusMm, factor),
    })),
    constraints: sketch.constraints.map((constraint) => scaledConstraint(constraint, factor)),
  };
}

function scaledParameter(parameter: NamedSketchParameter, factor: number): NamedSketchParameter {
  if (typeof parameter.value === 'string')
    return { ...parameter, value: scaledExpression(parameter.value, factor) };
  return parameter.unit === 'mm'
    ? { ...parameter, value: scaledLengthMm(parameter.value, factor) }
    : parameter;
}

// x, y, distance and diameter values are all lengths; a parameter reference
// scales through its parameter.
function scaledConstraint(constraint: SketchConstraint, factor: number): SketchConstraint {
  if (!('value' in constraint) || typeof constraint.value !== 'number') return constraint;
  return { ...constraint, value: scaledLengthMm(constraint.value, factor) };
}

// Rewrites only each number the parser reads as millimetres (a number followed
// by `mm`), keeping the operator's spacing and every other token as typed.
function scaledExpression(expression: string, factor: number): string {
  const tokens = [...expression.matchAll(SKETCH_EXPRESSION_TOKEN)];
  let scaled = '';
  let cursor = 0;
  for (const [index, token] of tokens.entries()) {
    const text = token[0];
    if (!/^[\d.]/.test(text) || tokens[index + 1]?.[0] !== 'mm') continue;
    const start = token.index ?? 0;
    scaled += expression.slice(cursor, start) + String(scaledLengthMm(Number(text), factor));
    cursor = start + text.length;
  }
  return scaled + expression.slice(cursor);
}
