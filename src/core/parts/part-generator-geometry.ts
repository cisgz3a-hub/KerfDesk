import type { CurveSubpath, Vec2 } from '../scene/scene-object';
import type { PartGeneratorDefinition } from './part-generator';

export type GeneratedPartHole = {
  readonly key: string;
  readonly center: Vec2;
  readonly diameterMm: number;
};
export function partGeneratorBoundary(definition: PartGeneratorDefinition): ReadonlyArray<Vec2> {
  const { widthMm: w, heightMm: h } = definition;
  return definition.kind === 'bracket'
    ? [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: definition.legWidthMm },
        { x: definition.legWidthMm, y: definition.legWidthMm },
        { x: definition.legWidthMm, y: h },
        { x: 0, y: h },
      ]
    : [
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ];
}
export function partGeneratorHoles(
  definition: PartGeneratorDefinition,
): ReadonlyArray<GeneratedPartHole> {
  if (definition.kind === 'panel')
    return mountingHoles(definition, definition.edgeOffsetMm, definition.holeDiameterMm);
  if (definition.kind === 'bracket')
    return [
      {
        key: 'mount-horizontal',
        center: { x: definition.widthMm - definition.holeOffsetMm, y: definition.legWidthMm / 2 },
        diameterMm: definition.holeDiameterMm,
      },
      {
        key: 'mount-vertical',
        center: { x: definition.legWidthMm / 2, y: definition.heightMm - definition.holeOffsetMm },
        diameterMm: definition.holeDiameterMm,
      },
    ];
  const holes = Array.from({ length: definition.rows * definition.columns }, (_, index) => ({
    key: 'hole-r' + Math.floor(index / definition.columns) + '-c' + (index % definition.columns),
    center: {
      x: gridPosition(
        index % definition.columns,
        definition.columns,
        definition.widthMm,
        definition.edgeOffsetMm,
      ),
      y: gridPosition(
        Math.floor(index / definition.columns),
        definition.rows,
        definition.heightMm,
        definition.edgeOffsetMm,
      ),
    },
    diameterMm: definition.holeDiameterMm,
  }));
  return definition.kind === 'fixture'
    ? [...mountingHoles(definition, definition.mountOffsetMm, definition.mountDiameterMm), ...holes]
    : holes;
}
function gridPosition(index: number, count: number, span: number, offset: number): number {
  return count === 1 ? span / 2 : offset + (index * (span - 2 * offset)) / (count - 1);
}
function mountingHoles(
  definition: PartGeneratorDefinition,
  offset: number,
  diameterMm: number,
): ReadonlyArray<GeneratedPartHole> {
  return [
    { key: 'mount-bottom-left', center: { x: offset, y: offset }, diameterMm },
    {
      key: 'mount-bottom-right',
      center: { x: definition.widthMm - offset, y: offset },
      diameterMm,
    },
    {
      key: 'mount-top-right',
      center: { x: definition.widthMm - offset, y: definition.heightMm - offset },
      diameterMm,
    },
    { key: 'mount-top-left', center: { x: offset, y: definition.heightMm - offset }, diameterMm },
  ];
}
export function exactHoleCurve(hole: GeneratedPartHole): CurveSubpath {
  const radius = hole.diameterMm / 2;
  const start = { x: hole.center.x + radius, y: hole.center.y };
  return {
    start,
    closed: true,
    segments: [
      {
        kind: 'elliptical-arc',
        radiusX: radius,
        radiusY: radius,
        rotationDeg: 0,
        largeArc: false,
        sweep: false,
        to: { x: hole.center.x - radius, y: hole.center.y },
      },
      {
        kind: 'elliptical-arc',
        radiusX: radius,
        radiusY: radius,
        rotationDeg: 0,
        largeArc: false,
        sweep: false,
        to: start,
      },
    ],
  };
}
export function generatedHoleProblem(
  definition: PartGeneratorDefinition,
  holes: ReadonlyArray<GeneratedPartHole>,
): string | null {
  if (holes.some((hole) => !holeInsideBoundary(definition, hole)))
    return 'A generated hole crosses the part boundary.';
  for (let index = 0; index < holes.length; index += 1) {
    const hole = holes[index];
    if (hole === undefined) continue;
    if (
      holes
        .slice(index + 1)
        .some(
          (other) =>
            Math.hypot(hole.center.x - other.center.x, hole.center.y - other.center.y) <=
            (hole.diameterMm + other.diameterMm) / 2,
        )
    )
      return 'Generated holes overlap or touch. Increase the part dimensions or reduce the hole count or diameter.';
  }
  return null;
}
function holeInsideBoundary(definition: PartGeneratorDefinition, hole: GeneratedPartHole): boolean {
  const radius = hole.diameterMm / 2,
    { x, y } = hole.center;
  if (
    x - radius <= 0 ||
    y - radius <= 0 ||
    x + radius >= definition.widthMm ||
    y + radius >= definition.heightMm
  )
    return false;
  if (definition.kind !== 'bracket') return true;
  return x + radius < definition.legWidthMm || y + radius < definition.legWidthMm;
}
