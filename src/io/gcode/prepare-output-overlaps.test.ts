import { expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { prepareOutput } from './prepare-output';

it('compares overlapping lines only after final program placement and coordinate rounding', () => {
  const project = createProject();
  const layer = createLayer({ id: 'line', color: '#000000' });
  const source = {
    ...project,
    optimization: { ...project.optimization, removeOverlappingLines: true },
    scene: {
      layers: [layer],
      objects: [
        {
          kind: 'imported-svg' as const,
          id: 'lines',
          source: 'lines.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0.0004 },
          paths: [
            {
              color: layer.color,
              operationIds: [layer.id],
              polylines: [0, 0.0004].map((y) => ({
                closed: false,
                points: [
                  { x: 0, y },
                  { x: 10, y },
                ],
              })),
            },
          ],
        },
      ],
    },
  };
  const count = (y: number): number => {
    const prepared = prepareOutput(source, { absoluteProgramOffset: { x: 10, y } });
    if (!prepared.ok) throw new Error('preparation failed');
    return prepared.job.groups.reduce(
      (sum, group) => sum + (group.kind === 'cut' ? group.segments.length : 0),
      0,
    );
  };
  expect(count(0)).toBe(1); // Both emitted at Y0.000.
  expect(count(-0.0003)).toBe(2); // Front-left origin flips Y: the placed lines now round apart.
});
