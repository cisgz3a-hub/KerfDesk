import type {
  ConstrainedSketch2d,
  NamedSketchParameter,
  SketchConstraint,
} from '../../core/sketch-constraints/constrained-sketch';
export type SketchPrimitive = 'line' | 'rectangle' | 'circle';
type Dimensions = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};
type Point = ConstrainedSketch2d['points'][number];
type Line = ConstrainedSketch2d['lines'][number];
type PrimitiveDraft = {
  readonly kind: SketchPrimitive;
  readonly dimensions: Dimensions;
  readonly entityId: string;
  readonly points: readonly Point[];
  readonly lines: readonly Line[];
  readonly nextId: (prefix: string) => string;
};
export function appendSketchPrimitive(
  sketch: ConstrainedSketch2d,
  kind: SketchPrimitive,
  values: readonly number[],
): ConstrainedSketch2d | null {
  const dimensions = primitiveDimensions(kind, values);
  if (dimensions === null || !hasRoom(sketch, kind)) return null;
  const draft = primitiveDraft(sketch, kind, dimensions);
  if (draft.points.some((point) => Math.abs(point.x) > 1_000_000 || Math.abs(point.y) > 1_000_000))
    return null;
  const retained = primitiveConstraints(sketch, draft);
  const placeholder = isEmptyPlaceholder(sketch);
  return {
    ...sketch,
    ...retained,
    points: [...(placeholder ? [] : sketch.points), ...draft.points],
    lines: [...sketch.lines, ...draft.lines],
    circles:
      kind === 'circle'
        ? [
            ...sketch.circles,
            { id: draft.entityId, centre: pointId(draft.points, 0), radiusMm: dimensions.w / 2 },
          ]
        : sketch.circles,
    profiles:
      kind === 'rectangle'
        ? [
            ...sketch.profiles,
            { id: draft.entityId, pointIds: draft.points.map((p) => p.id), closed: true },
          ]
        : sketch.profiles,
  };
}
function isEmptyPlaceholder(sketch: ConstrainedSketch2d): boolean {
  return (
    sketch.points.length === 1 &&
    sketch.lines.length === 0 &&
    sketch.circles.length === 0 &&
    sketch.profiles.length === 0 &&
    sketch.constraints.length === 0
  );
}
function isDimensionTuple(
  values: readonly number[],
): values is readonly [number, number, number, number] {
  return values.length === 4 && Array.from(values).every(Number.isFinite);
}
function primitiveDimensions(kind: SketchPrimitive, values: readonly number[]): Dimensions | null {
  if (!isDimensionTuple(values)) return null;
  const [x, y, w, h] = values;
  if (!validDimensions(kind, { x, y, w, h })) return null;
  return { x, y, w, h };
}
function validDimensions(kind: SketchPrimitive, { x, y, w, h }: Dimensions): boolean {
  switch (kind) {
    case 'circle':
      return w > 0 && w / 2 <= 100_000;
    case 'rectangle':
      return w > 0 && h > 0 && w <= 1_000_000 && h <= 1_000_000;
    case 'line':
      return w !== x || h !== y;
  }
}
function hasRoom(sketch: ConstrainedSketch2d, kind: SketchPrimitive): boolean {
  const additions = {
    rectangle: [4, 4, 0, 1, 8, 4],
    line: [2, 1, 0, 0, 4, 4],
    circle: [1, 0, 1, 0, 3, 3],
  }[kind];
  const sizes = [
    sketch.points.length,
    sketch.lines.length,
    sketch.circles.length,
    sketch.profiles.length,
    sketch.constraints.length,
    sketch.parameters.length,
  ];
  const limits = [32, 64, 16, 64, 128, 64];
  return additions.every(
    (addition, index) => (sizes[index] ?? 0) + addition <= (limits[index] ?? 0),
  );
}
function pointId(points: readonly Point[], index: number): string {
  const point = points[index];
  if (point === undefined) throw new Error('Invalid sketch primitive point index');
  return point.id;
}
function primitiveDraft(
  sketch: ConstrainedSketch2d,
  kind: SketchPrimitive,
  dimensions: Dimensions,
): PrimitiveDraft {
  const ids = new Set(
    [
      ...sketch.points,
      ...sketch.lines,
      ...sketch.circles,
      ...sketch.profiles,
      ...sketch.constraints,
    ].map((item) => item.id),
  );
  const nextId = (prefix: string): string => {
    let n = 1;
    while (ids.has(prefix + n)) n++;
    const next = prefix + n;
    ids.add(next);
    return next;
  };
  const { x, y, w, h } = dimensions;
  const coordinates: readonly (readonly [number, number])[] =
    kind === 'rectangle'
      ? [
          [x, y],
          [x + w, y],
          [x + w, y + h],
          [x, y + h],
        ]
      : kind === 'line'
        ? [
            [x, y],
            [w, h],
          ]
        : [[x, y]];
  const points = coordinates.map(([px, py]) => ({ id: nextId('p'), x: px, y: py }));
  const lines =
    kind === 'circle'
      ? []
      : (kind === 'line' ? [0] : [0, 1, 2, 3]).map((i) => ({
          id: nextId('line'),
          first: pointId(points, i),
          second: pointId(points, (i + 1) % points.length),
        }));
  return {
    kind,
    dimensions,
    points,
    lines,
    nextId,
    entityId: nextId(kind === 'rectangle' ? 'outline' : kind === 'circle' ? 'circle' : 'segment'),
  };
}
function primitiveConstraints(
  sketch: ConstrainedSketch2d,
  draft: PrimitiveDraft,
): {
  readonly parameters: readonly NamedSketchParameter[];
  readonly constraints: readonly SketchConstraint[];
} {
  const {
    kind,
    dimensions: { x, y, w, h },
    points,
    lines,
    nextId,
    entityId,
  } = draft;
  const parameters = [...sketch.parameters],
    constraints = [...sketch.constraints];
  const dimension = (suffix: string, value: number): { readonly parameter: string } => {
    let name = entityId + '_' + suffix;
    let ordinal = 1;
    while (parameters.some((p) => p.name === name)) {
      name = entityId + '_' + suffix + '_' + ordinal;
      ordinal++;
    }
    parameters.push({ name, unit: 'mm', value });
    return { parameter: name };
  };
  const position = (index: number, axis: 'x' | 'y', suffix: string, value: number): void => {
    constraints.push({
      id: nextId('position'),
      kind: axis,
      pointId: pointId(points, index),
      value: dimension(suffix, value),
    });
  };
  position(0, 'x', 'x', x);
  position(0, 'y', 'y', y);
  if (kind === 'circle')
    constraints.push({
      id: nextId('diameter'),
      kind: 'diameter',
      circleId: entityId,
      value: dimension('diameter', w),
    });
  else if (kind === 'line') {
    position(1, 'x', 'end_x', w);
    position(1, 'y', 'end_y', h);
  } else {
    for (const [index, line] of lines.entries())
      constraints.push({
        id: nextId('relation'),
        kind: index % 2 === 0 ? 'horizontal' : 'vertical',
        lineId: line.id,
      });
    constraints.push({
      id: nextId('width'),
      kind: 'distance',
      first: pointId(points, 0),
      second: pointId(points, 1),
      value: dimension('width', w),
    });
    constraints.push({
      id: nextId('height'),
      kind: 'distance',
      first: pointId(points, 1),
      second: pointId(points, 2),
      value: dimension('height', h),
    });
  }
  return { parameters, constraints };
}
