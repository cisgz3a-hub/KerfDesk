import { describe, expect, it } from 'vitest';
import { tangentCircles } from '../../core/geometry/tangent-circles';
import { combinedBBox, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { createEllipse } from '../../core/shapes/primitives/create-ellipse';
import { createRectangle } from '../../core/shapes/primitives/create-rectangle';
import { selectedThreeCircles, tangentCircleShape } from './TangentCircleDialog';

function circle(id: string, x: number, y: number, diameter: number) {
  return createEllipse({
    id,
    color: '#000000',
    spec: { widthMm: diameter, heightMm: diameter },
    transform: { ...IDENTITY_TRANSFORM, x: x - diameter / 2, y: y - diameter / 2 },
  });
}

describe('Tangent Circle', () => {
  const project = {
    ...createProject(),
    scene: {
      ...createProject().scene,
      objects: [
        circle('a', 0, 0, 2),
        circle('b', 10, 0, 4),
        circle('c', 4, 8, 3),
        createRectangle({
          id: 'r',
          color: '#000000',
          spec: { widthMm: 5, heightMm: 5, cornerRadiusMm: 0 },
        }),
      ],
    },
  };

  it('reads the three selected circles from their world placement', () => {
    expect(selectedThreeCircles(project, ['a', 'b', 'c'])).toEqual([
      { center: { x: 0, y: 0 }, radius: 1 },
      { center: { x: 10, y: 0 }, radius: 2 },
      { center: { x: 4, y: 8 }, radius: 1.5 },
    ]);
    expect(selectedThreeCircles(project, ['a', 'b', 'r'])).toBeNull();
    expect(selectedThreeCircles(project, ['a', 'b'])).toBeNull();
  });

  it('adds the chosen solution as a circle centred where the maths puts it', () => {
    const circles = selectedThreeCircles(project, ['a', 'b', 'c']);
    if (circles === null) throw new Error('expected three circles');
    const [solution] = tangentCircles(...circles);
    if (solution === undefined) throw new Error('expected a solution');
    const shape = tangentCircleShape(solution, '#ff0000');
    const box = combinedBBox([shape]);
    expect(box?.minX).toBeCloseTo(solution.center.x - solution.radius, 6);
    expect(box?.maxY).toBeCloseTo(solution.center.y + solution.radius, 6);
    expect(shape.color).toBe('#ff0000');
  });
});
