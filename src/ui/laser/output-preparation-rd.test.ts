import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile } from '../../io/rd';
import { outputPreparationShouldRunOffThread } from './output-preparation-worker-client';
import { prepareOutputRequest } from './output-preparation';

const HEAVY_LINE_PASSES = 100_000;
const EQUIVALENCE_TIMEOUT_MS = 30_000;

describe('Ruida background output preparation', () => {
  it(
    'matches direct bytes and advisories for a valid costly line job',
    async () => {
      const project = heavyRuidaLineProject();
      expect(outputPreparationShouldRunOffThread(project)).toBe(true);
      const direct = emitRdFile(project);
      if (!direct.ok) throw new Error('direct fixture emission failed');

      const response = await prepareOutputRequest(
        { kind: 'rd', project, options: {} },
        { jobId: 'rd-equivalence' },
      );

      expect(response.kind).toBe('rd');
      if (response.kind !== 'rd' || !response.result.ok) {
        throw new Error('background fixture emission failed');
      }
      expect(response.result.bytes).toEqual(direct.bytes);
      expect(response.result.advisories).toEqual(direct.advisories);
    },
    EQUIVALENCE_TIMEOUT_MS,
  );
});

function heavyRuidaLineProject(): Project {
  const color = '#000000';
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
    scene: {
      layers: [
        {
          ...createLayer({ id: color, color, mode: 'line' }),
          passes: HEAVY_LINE_PASSES,
        },
      ],
      objects: [
        {
          kind: 'imported-svg',
          id: 'heavy-line',
          source: 'heavy-line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color,
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
