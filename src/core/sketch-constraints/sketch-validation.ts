import { z } from 'zod';
import type { ConstrainedSketch2d, SketchConstraint } from './constrained-sketch';
export const SKETCH_MAX_RADIUS_MM = 100_000;
const id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z_0-9-]*$/)
  .max(100);
const finite = z.number().finite().min(-1_000_000).max(1_000_000);
const length = z.union([finite, z.object({ parameter: id }).strict()]);
const constraints = z.discriminatedUnion('kind', [
  z.object({ id, kind: z.literal('x'), pointId: id, value: length }).strict(),
  z.object({ id, kind: z.literal('y'), pointId: id, value: length }).strict(),
  z.object({ id, kind: z.literal('coincident'), first: id, second: id }).strict(),
  z.object({ id, kind: z.literal('horizontal'), lineId: id }).strict(),
  z.object({ id, kind: z.literal('vertical'), lineId: id }).strict(),
  z.object({ id, kind: z.literal('distance'), first: id, second: id, value: length }).strict(),
  z.object({ id, kind: z.literal('equal'), firstLineId: id, secondLineId: id }).strict(),
  z.object({ id, kind: z.literal('diameter'), circleId: id, value: length }).strict(),
]);
const sketch = z
  .object({
    version: z.literal(1),
    name: z.string().min(1).max(120),
    parameters: z
      .array(
        z
          .object({
            name: id,
            unit: z.enum(['mm', 'deg', 'scalar']),
            value: z.union([finite, z.string().min(1).max(512)]),
          })
          .strict(),
      )
      .max(64),
    points: z
      .array(z.object({ id, x: finite, y: finite }).strict())
      .min(1)
      .max(32),
    lines: z.array(z.object({ id, first: id, second: id }).strict()).max(64),
    circles: z
      .array(
        z
          .object({
            id,
            centre: id,
            radiusMm: z.number().finite().positive().max(SKETCH_MAX_RADIUS_MM),
          })
          .strict(),
      )
      .max(16),
    profiles: z
      .array(z.object({ id, pointIds: z.array(id).min(2).max(128), closed: z.boolean() }).strict())
      .max(64),
    constraints: z.array(constraints).max(128),
  })
  .strict();
export function parseConstrainedSketch(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly sketch: ConstrainedSketch2d }
  | { readonly kind: 'invalid'; readonly reason: string } {
  const result = sketch.safeParse(value);
  if (!result.success) return { kind: 'invalid', reason: 'Malformed or over-budget 2D sketch.' };
  const s = result.data;
  for (const entries of [
    s.parameters.map((item) => item.name),
    s.points.map((item) => item.id),
    s.lines.map((item) => item.id),
    s.circles.map((item) => item.id),
    s.profiles.map((item) => item.id),
    s.constraints.map((item) => item.id),
  ])
    if (new Set(entries).size !== entries.length)
      return { kind: 'invalid', reason: 'Duplicate 2D sketch identity.' };
  const points = new Set(s.points.map((point) => point.id)),
    lines = new Set(s.lines.map((line) => line.id)),
    circles = new Set(s.circles.map((circle) => circle.id));
  if (
    s.lines.some((line) => !points.has(line.first) || !points.has(line.second)) ||
    s.circles.some((circle) => !points.has(circle.centre)) ||
    s.profiles.some((profile) => profile.pointIds.some((point) => !points.has(point)))
  )
    return { kind: 'invalid', reason: 'Missing sketch entity reference.' };
  for (const c of s.constraints) {
    const valid = constraintHasEntities(c, points, lines, circles);
    if (!valid) return { kind: 'invalid', reason: 'Missing entity in constraint ' + c.id };
  }
  return { kind: 'ok', sketch: s };
}
export function validateConstrainedSketch(value: unknown): string | null {
  if (value === undefined) return null;
  const parsed = parseConstrainedSketch(value);
  return parsed.kind === 'ok' ? null : parsed.reason;
}

function constraintHasEntities(
  c: SketchConstraint,
  points: ReadonlySet<string>,
  lines: ReadonlySet<string>,
  circles: ReadonlySet<string>,
): boolean {
  switch (c.kind) {
    case 'x':
    case 'y':
      return points.has(c.pointId);
    case 'horizontal':
    case 'vertical':
      return lines.has(c.lineId);
    case 'equal':
      return lines.has(c.firstLineId) && lines.has(c.secondLineId);
    case 'diameter':
      return circles.has(c.circleId);
    case 'coincident':
    case 'distance':
      return points.has(c.first) && points.has(c.second);
  }
}
