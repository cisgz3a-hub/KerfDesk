import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
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
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';

describe('relief materialization compile integrity', () => {
  it('reports an impossible persisted slope-step Array from sync and background preparation', async () => {
    const project = persistedSlopeStepProject(1e-12);
    const expected = {
      ok: false,
      preflight: {
        issues: [
          {
            code: 'relief-materialization-failed',
            message: expect.stringMatching(/fine-depth\.png.*roughing level count.*Array length/s),
          },
        ],
      },
    };
    expect(prepareOutput(project)).toMatchObject(expected);
    expect(
      await prepareOutputAsync(project, {}, { jobId: 'fine-step', runCncTasks: async () => [] }),
    ).toMatchObject(expected);
  });

  it('still prepares a persisted ordinary slope step without changing its value', () => {
    expect(prepareOutput(persistedSlopeStepProject(0.3)).ok).toBe(true);
  });

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

function persistedSlopeStepProject(step: number): Project {
  const base = mixedReliefProject({
    source: 'fine-depth.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 1,
      samplesU16: [0],
    }),
    reliefDepthMm: 1,
  });
  const project = {
    ...base,
    scene: {
      ...base.scene,
      layers: base.scene.layers.map((layer) => ({
        ...layer,
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, depthPerPassMm: 1, reliefFineStepMm: step },
      })),
    },
  };
  const loaded = deserializeProject(serializeProject(project));
  if (loaded.kind !== 'ok') throw new Error('expected project to load');
  expect(loaded.project.scene.layers[0]?.cnc?.reliefFineStepMm).toBe(step);
  return loaded.project;
}

function mixedMalformedReliefProject(): Project {
  return mixedReliefProject({
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
    reliefDepthMm: 3,
  });
}

function mixedUnrepresentablePassReliefProject(): Project {
  return mixedReliefProject({
    source: 'extreme-depth.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 0x1_0000_0000,
      samplesU16: [0],
      provenance: { sourceName: 'extreme-depth.png' },
    }),
    reliefDepthMm: 0x1_0000_0000,
  });
}

function mixedReliefProject(reliefFixture: {
  readonly source: string;
  readonly reliefSource: ReturnType<typeof testReliefHeightfield>;
  readonly reliefDepthMm: number;
}): Project {
  const base = createProject();
  const color = '#a0522d';
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'bad-relief',
    source: reliefFixture.source,
    reliefSource: reliefFixture.reliefSource,
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
