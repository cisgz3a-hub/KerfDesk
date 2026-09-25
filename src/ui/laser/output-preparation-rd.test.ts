import { deepStrictEqual } from 'node:assert/strict';
import { describe, expect, it } from 'vitest';
import { swizzleBytes } from '../../core/controllers/ruida';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitRdFile, type EmitRdOptions } from '../../io/rd';
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
      // Native typed-array equality checks every byte without per-byte matcher traversal.
      deepStrictEqual(response.result.bytes, direct.bytes);
      expect(response.result.advisories).toEqual(direct.advisories);
    },
    EQUIVALENCE_TIMEOUT_MS,
  );

  // Audit RU-2: the worker encoded without the request options, so its file
  // could name a different reference point than the direct path.
  it('encodes with the request placement', async () => {
    const project = heavyRuidaLineProject(1);
    const options: EmitRdOptions = {
      jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
    };
    const direct = emitRdFile(project, options);
    if (!direct.ok) throw new Error('direct fixture emission failed');

    const response = await prepareOutputRequest(
      { kind: 'rd', project, options },
      { jobId: 'rd-placement' },
    );

    if (response.kind !== 'rd' || !response.result.ok) {
      throw new Error('background fixture emission failed');
    }
    deepStrictEqual(response.result.bytes, direct.bytes);
    expect(response.result.advisories).toEqual(direct.advisories);
    // D8 11 "Ref Point Mode 1, Anchor Point" swizzled with magic 0x88.
    expect([...response.result.bytes.slice(0, 2)]).toEqual([...swizzleBytes([0xd8, 0x11])]);
  });
});

function heavyRuidaLineProject(passes = HEAVY_LINE_PASSES): Project {
  const color = '#000000';
  return {
    ...createProject(),
    device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' },
    scene: {
      layers: [
        {
          ...createLayer({ id: color, color, mode: 'line' }),
          passes,
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
