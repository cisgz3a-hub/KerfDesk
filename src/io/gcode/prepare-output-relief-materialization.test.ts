import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { prepareProjectForPersistence } from '../project';
import { legacyFloat32OverflowProject } from './legacy-float32-materialization-test-project';
import { prepareOutputAsync } from './prepare-output-async';
import { prepareOutput } from './prepare-output';

describe('relief materialization compile integrity', () => {
  it('refuses the whole mixed job when stored relief samples cannot materialize', () => {
    expect(prepareOutput(mixedMalformedReliefProject())).toMatchObject({
      ok: false,
      preflight: {
        ok: false,
        issues: [
          {
            code: 'relief-materialization-failed',
            message: expect.stringMatching(/broken-depth\.png.*payload length.*Re-import/s),
          },
        ],
      },
    });
  });

  it('returns the same named failure from background output preparation', async () => {
    const prepared = await prepareOutputAsync(
      mixedMalformedReliefProject(),
      {},
      {
        jobId: 'malformed-relief',
        runCncTasks: async () => [],
      },
    );

    expect(prepared).toMatchObject({
      ok: false,
      preflight: { issues: [{ code: 'relief-materialization-failed' }] },
    });
  });

  it('keeps finite persisted mesh data saveable but refuses its Float32 Z overflow', () => {
    const input = legacyFloat32OverflowProject();
    expect(prepareProjectForPersistence(input)).toMatchObject({ kind: 'ok' });
    expect(prepareOutput(input)).toMatchObject({
      ok: false,
      preflight: {
        issues: [
          {
            code: 'relief-materialization-failed',
            message: expect.stringMatching(/overflow-z\.stl.*Mesh bounds must be finite/s),
          },
        ],
      },
    });
  });
});

function mixedMalformedReliefProject(): Project {
  const base = createProject();
  const color = '#a0522d';
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'bad-relief',
    source: 'broken-depth.png',
    reliefSource: {
      ...testReliefHeightfield({
        width: 2,
        height: 2,
        physicalWidthMm: 20,
        physicalHeightMm: 20,
        maxDepthMm: 3,
        samplesU8: [0, 255, 128, 255],
        provenance: { sourceName: 'broken-depth.png' },
      }),
      samplesBase64: 'AA==',
    },
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
  const vector: SceneObject = {
    kind: 'imported-svg',
    id: 'valid-vector',
    source: 'valid.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...base,
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: {
      objects: [vector, relief],
      layers: [createLayer({ id: 'relief-op', color })],
    },
  };
}
