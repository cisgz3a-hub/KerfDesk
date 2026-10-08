import type {
  ConstrainedSketch2d,
  SketchConstraint,
  SketchValue,
} from '../../core/sketch-constraints/constrained-sketch';
export function sketchConstraintValue(text: string): SketchValue {
  return text.trim() !== '' && Number.isFinite(Number(text)) ? Number(text) : { parameter: text };
}
export function sketchConstraintLabel(c: SketchConstraint): string {
  if (c.kind === 'x' || c.kind === 'y') return c.kind + ' position of ' + c.pointId;
  if (c.kind === 'horizontal' || c.kind === 'vertical') return c.kind + ' ' + c.lineId;
  if (c.kind === 'diameter') return 'diameter of ' + c.circleId;
  if (c.kind === 'equal') return 'equal lengths ' + c.firstLineId + ' and ' + c.secondLineId;
  if (c.kind === 'coincident' || c.kind === 'distance')
    return c.kind + ' ' + c.first + ' and ' + c.second;
  return c.id;
}
export function newSketchConstraint(
  sketch: ConstrainedSketch2d,
  kind: SketchConstraint['kind'],
  first: string,
  second: string,
  value: string,
): SketchConstraint {
  let ordinal = 1;
  while (sketch.constraints.some((c) => c.id === 'constraint_' + ordinal)) ordinal += 1;
  const id = 'constraint_' + ordinal,
    dimension = sketchConstraintValue(value);
  if (kind === 'x' || kind === 'y') return { id, kind, pointId: first, value: dimension };
  if (kind === 'horizontal' || kind === 'vertical') return { id, kind, lineId: first };
  if (kind === 'equal') return { id, kind, firstLineId: first, secondLineId: second };
  if (kind === 'diameter') return { id, kind, circleId: first, value: dimension };
  if (kind === 'coincident') return { id, kind, first, second };
  return { id, kind: 'distance', first, second, value: dimension };
}

export function sketchConstraintEntities(
  sketch: ConstrainedSketch2d,
  kind: SketchConstraint['kind'],
): readonly { readonly id: string }[] {
  if (kind === 'horizontal' || kind === 'vertical' || kind === 'equal') return sketch.lines;
  return kind === 'diameter' ? sketch.circles : sketch.points;
}
export function constraintNeedsPair(kind: SketchConstraint['kind']): boolean {
  return kind === 'equal' || kind === 'coincident' || kind === 'distance';
}
export function constraintNeedsDimension(kind: SketchConstraint['kind']): boolean {
  return kind === 'x' || kind === 'y' || kind === 'distance' || kind === 'diameter';
}
