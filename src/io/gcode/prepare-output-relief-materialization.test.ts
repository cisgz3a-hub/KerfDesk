import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
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

  it('fails before attempting a Z-pass Array that the runtime cannot represent', () => {
    expect(prepareOutput(mixedUnrepresentablePassReliefProject())).toMatchObject({
      ok: false,
      preflight: {
        issues: [
          {
            code: 'relief-materialization-failed',
            message: expect.stringMatching(/extreme-depth\.png.*Z-pass count.*Array length/s),
          },
        ],
      },
    });
  });
});

function mixedMalformedReliefProject(): Project {
  return mixedReliefProject({
    source: 'broken-depth.png',
    depthMap: {
      schemaVersion: 1,
      width: 2,
      height: 2,
      bitDepth: 8,
      samplesBase64: 'AA==',
      polarity: 'light-is-high',
    },
    reliefDepthMm: 3,
  });
}

function mixedUnrepresentablePassReliefProject(): Project {
  return mixedReliefProject({
    source: 'extreme-depth.png',
    depthMap: {
      schemaVersion: 1,
      width: 1,
      height: 1,
      bitDepth: 8,
      samplesBase64: 'AA==',
      polarity: 'light-is-high',
    },
    reliefDepthMm: 0x1_0000_0000,
  });
}

function mixedReliefProject(reliefFixture: {
  readonly source: string;
  readonly depthMap: NonNullable<ReliefObject['depthMap']>;
  readonly reliefDepthMm: number;
}): Project {
  const base = createProject();
  const color = '#a0522d';
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'bad-relief',
    source: reliefFixture.source,
    depthMap: reliefFixture.depthMap,
    targetWidthMm: 20,
    reliefDepthMm: reliefFixture.reliefDepthMm,
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
      layers: [
        {
          ...createLayer({ id: 'relief-op', color }),
          cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1 },
        },
      ],
    },
  };
}
