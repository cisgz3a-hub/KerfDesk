import type { ColoredPath } from '../scene/scene-object';
import { polylineToCurveSubpath } from '../scene/curve-path';
import type {
  PartGeneratorDefinition,
  PartGeneratorGeometry,
  PartGeneratorResult,
} from './part-generator';
import { PART_GENERATOR_COLOR } from './part-generator';
import { partGeneratorProblem } from './part-generator-validation';
import {
  exactHoleCurve,
  generatedHoleProblem,
  partGeneratorBoundary,
  partGeneratorHoles,
  type GeneratedPartHole,
} from './part-generator-geometry';

export function materializePartGenerator(
  definition: PartGeneratorDefinition,
): PartGeneratorResult<PartGeneratorGeometry> {
  const problem = partGeneratorProblem(definition);
  if (problem !== null) return { kind: 'invalid', reason: problem };
  const holes = partGeneratorHoles(definition);
  const holeProblem = generatedHoleProblem(definition, holes);
  if (holeProblem !== null) return { kind: 'invalid', reason: holeProblem };
  const boundary = { points: partGeneratorBoundary(definition), closed: true };
  return {
    kind: 'ok',
    value: {
      bounds: { minX: 0, minY: 0, maxX: definition.widthMm, maxY: definition.heightMm },
      paths: [
        {
          color: PART_GENERATOR_COLOR,
          polylines: [boundary],
          curves: [polylineToCurveSubpath(boundary)],
        },
        ...holes.map(holePath),
      ],
      source: {
        version: 1,
        definition: { ...definition },
        pathKeys: ['boundary', ...holes.map((hole) => hole.key)],
      },
    },
  };
}
function holePath(hole: GeneratedPartHole): ColoredPath {
  return {
    color: PART_GENERATOR_COLOR,
    polylines: [
      {
        closed: true,
        points: Array.from({ length: 64 }, (_, index) => ({
          x: hole.center.x + (hole.diameterMm / 2) * Math.cos((-index * Math.PI) / 32),
          y: hole.center.y + (hole.diameterMm / 2) * Math.sin((-index * Math.PI) / 32),
        })),
      },
    ],
    curves: [exactHoleCurve(hole)],
  };
}
