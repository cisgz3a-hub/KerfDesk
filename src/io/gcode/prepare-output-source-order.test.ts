import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type ProjectOptimizationSettings,
} from '../../core/scene';
import { prepareOutput } from './prepare-output';

describe('prepareOutput source-order precedence', () => {
  it('prepares identical path sequence and direction across bypassed settings', () => {
    const outputs = [
      preparedSegments({
        insideFirst: true,
        pathDirection: 'allow-reverse',
        startPoint: 'machine-origin',
      }),
      preparedSegments({
        insideFirst: false,
        pathDirection: 'preserve',
        startPoint: 'job-center',
      }),
    ];

    expect(outputs[0]).toEqual(outputs[1]);
    expect(outputs[0]?.map((segment) => segment.polyline[0]?.x)).toEqual([100, 0]);
  });
});

function preparedSegments(
  bypassed: Pick<ProjectOptimizationSettings, 'insideFirst' | 'pathDirection' | 'startPoint'>,
) {
  const base = createProject();
  const project: Project = {
    ...base,
    optimization: {
      ...base.optimization,
      reduceTravelMoves: false,
      travelPolicy: 'source-order',
      ...bypassed,
    },
    scene: {
      layers: [createLayer({ id: 'line', color: '#000000', mode: 'line' })],
      objects: [
        {
          kind: 'imported-svg',
          id: 'source-order',
          source: 'source-order.svg',
          bounds: { minX: 0, minY: 0, maxX: 110, maxY: 20 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#000000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 100, y: 10 },
                    { x: 90, y: 10 },
                  ],
                },
                {
                  closed: false,
                  points: [
                    { x: 0, y: 10 },
                    { x: 10, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Expected source-order project to prepare.');
  const group = prepared.job.groups.find((candidate) => candidate.kind === 'cut');
  if (group?.kind !== 'cut') throw new Error('Expected prepared cut group.');
  return group.segments;
}
