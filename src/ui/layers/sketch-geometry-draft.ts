import type {
  ConstrainedSketch2d,
  SketchConstraint,
} from '../../core/sketch-constraints/constrained-sketch';
import { defaultConstrainedSketch } from '../../core/sketch-constraints/default-constrained-sketch';
export type SketchTemplate = 'plate' | 'rectangle' | 'circle' | 'custom';
export function sketchFromTemplate(kind: SketchTemplate): ConstrainedSketch2d {
  const plate = defaultConstrainedSketch();
  if (kind === 'plate') return plate;
  if (kind === 'rectangle')
    return {
      ...plate,
      name: 'Rectangle',
      parameters: plate.parameters.slice(0, 2),
      points: plate.points.slice(0, 4),
      circles: [],
      constraints: plate.constraints.filter(
        (c) => !c.id.startsWith('hole') && c.kind !== 'diameter',
      ),
    };
  const base: ConstrainedSketch2d = {
    version: 1,
    name: 'Custom sketch',
    parameters: [],
    points: [{ id: 'centre', x: 0, y: 0 }],
    lines: [],
    circles: [],
    profiles: [],
    constraints: [],
  };
  if (kind === 'custom') return base;
  return {
    ...base,
    name: 'Circle',
    parameters: [{ name: 'diameter', unit: 'mm', value: 20 }],
    circles: [{ id: 'circle', centre: 'centre', radiusMm: 10 }],
    constraints: [
      { id: 'centre-x', kind: 'x', pointId: 'centre', value: 0 },
      { id: 'centre-y', kind: 'y', pointId: 'centre', value: 0 },
      {
        id: 'circle-diameter',
        kind: 'diameter',
        circleId: 'circle',
        value: { parameter: 'diameter' },
      },
    ],
  };
}
export { appendSketchPrimitive, type SketchPrimitive } from './sketch-primitive-draft';
export function removeSketchEntity(
  sketch: ConstrainedSketch2d,
  kind: 'line' | 'circle' | 'profile',
  id: string,
): ConstrainedSketch2d {
  const profile = kind === 'profile' ? sketch.profiles.find((p) => p.id === id) : undefined;
  const profiles = sketch.profiles.filter((p) => kind !== 'profile' || p.id !== id);
  const edges = (p: ConstrainedSketch2d['profiles'][number]): string[] =>
    p.pointIds
      .slice(0, p.closed ? undefined : -1)
      .map((point, i) => [point, p.pointIds[(i + 1) % p.pointIds.length]].sort().join(':'));
  const removedEdges = new Set(profile === undefined ? [] : edges(profile));
  const retainedEdges = new Set(profiles.flatMap(edges));
  const removedLines = sketch.lines.filter((line) =>
    kind === 'line'
      ? line.id === id
      : removedEdges.has([line.first, line.second].sort().join(':')) &&
        !retainedEdges.has([line.first, line.second].sort().join(':')),
  );
  const removedLineIds = new Set(removedLines.map((line) => line.id));
  const lines = sketch.lines.filter((line) => !removedLineIds.has(line.id));
  const removedCircles = sketch.circles.filter((c) => kind === 'circle' && c.id === id);
  const circles = sketch.circles.filter((c) => kind !== 'circle' || c.id !== id);
  const candidates = new Set([
    ...(profile?.pointIds ?? []),
    ...removedLines.flatMap((line) => [line.first, line.second]),
    ...removedCircles.map((circle) => circle.centre),
  ]);
  const used = new Set([
    ...lines.flatMap((line) => [line.first, line.second]),
    ...circles.map((circle) => circle.centre),
    ...profiles.flatMap((p) => p.pointIds),
  ]);
  const removedPoints = new Set([...candidates].filter((point) => !used.has(point)));
  const remaining = sketch.points.filter((point) => !removedPoints.has(point.id));
  const points = remaining.length === 0 ? sketch.points.slice(0, 1) : remaining;
  const lineIds = new Set(lines.map((l) => l.id)),
    circleIds = new Set(circles.map((c) => c.id));
  const keep = (c: SketchConstraint): boolean => {
    if (c.kind === 'x' || c.kind === 'y') return !removedPoints.has(c.pointId);
    if (c.kind === 'distance' || c.kind === 'coincident')
      return !removedPoints.has(c.first) && !removedPoints.has(c.second);
    if (c.kind === 'equal') return lineIds.has(c.firstLineId) && lineIds.has(c.secondLineId);
    if (c.kind === 'horizontal' || c.kind === 'vertical') return lineIds.has(c.lineId);
    return c.kind !== 'diameter' || circleIds.has(c.circleId);
  };
  return {
    ...sketch,
    points,
    lines,
    circles,
    profiles,
    constraints: sketch.constraints.filter(keep),
  };
}
