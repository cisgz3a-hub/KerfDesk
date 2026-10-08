import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveTopologyProject,
  historicalNestingJob,
  repeatedPowerProject,
  topologyOptimization,
} from '../../__fixtures__/topology-archive';
import { PRE_K1_BYTES, PRE_K1_FINGERPRINTS } from '../../__fixtures__/topology-legacy-bytes';
import type { Job } from '../../core/job/job';
import * as optimizer from '../../core/job/optimize-paths';
import { fingerprintGcode } from '../../core/recovery';
import {
  createLayer,
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { prepareOutput, type PreparedOutput } from './prepare-output';
import { emitPreparedGcode } from './emit-gcode';
import { EMITTER_REVISION } from './gcode-metadata';
import { hydratePreparedExecutionOutput } from './prepared-output-persistence';
import { createCurrentTestExecutionArtifact } from '../../ui/state/recovery/testing';
import { computeExecutionProvenanceEnvelopeSha256 } from '../../ui/state/recovery/execution-provenance';
import {
  decodeExecutionArtifactExport,
  serializeExecutionArtifactExport,
} from '../../ui/laser/execution-artifact-export-codec';
import { recoveryArtifactPreparedProgramMatches } from '../../ui/laser/recovery-artifact-binding';
import { prepareOutputRequest } from '../../ui/laser/output-preparation';
import { hydrateTransferredStartPreparation } from '../../ui/laser/output-preparation-worker-client';
import { DEFAULT_JOB_PLACEMENT } from '../../ui/job-placement';

type Prepared = Extract<PreparedOutput, { readonly ok: true }>;
const oldRevision = 'cnc-finish-ladder-thin-stock-tabs-mesh-footprint-20260929-v16';
const idle = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  wco: null,
  feed: 0,
  spindle: 0,
};
afterEach(() => vi.restoreAllMocks());
function preparedProject(project = archiveTopologyProject()): Prepared {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('Topology fixture did not prepare');
  return prepared;
}
function parentMetadata(job: Job) {
  return job.groups.flatMap((g) =>
    g.kind !== 'cut'
      ? []
      : [
          {
            scope: g.topologyScope,
            power: g.power,
            passes: g.passes,
            speed: g.speed,
            tabPower: g.tabSpanPowerPercent,
            nesting: g.segments.map((s) => s.nesting),
          },
        ],
  );
}
function assertNewParents(job: Job) {
  const metadata = parentMetadata(job);
  expect(metadata.length).toBeGreaterThan(2);
  expect(
    metadata.every(
      (g) =>
        typeof g.scope === 'string' &&
        g.nesting.every((n) => typeof n?.topologyContour === 'string'),
    ),
  ).toBe(true);
  expect(new Set(metadata.flatMap((g) => g.nesting.map((n) => n?.topologyContour))).size).toBe(2);
  expect(metadata.some((g) => g.tabPower === 20)).toBe(true);
}
function mixedRasterPrepared(): Prepared {
  const base = archiveTopologyProject();
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'image',
    source: 'tiny.png',
    operationIds: ['image-operation'],
    color: '#111111',
    dataUrl: 'data:image/png;base64,source',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    dither: 'threshold',
    linesPerMm: 1,
    bounds: { minX: 160, minY: 10, maxX: 162, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
  };
  const project: Project = {
    ...base,
    scene: {
      ...base.scene,
      objects: [...base.scene.objects, image],
      layers: [
        ...base.scene.layers,
        {
          ...createLayer({ id: 'image-operation', color: '#111111', mode: 'image' }),
          power: 10,
          linesPerMm: 1,
          ditherAlgorithm: 'threshold',
          fillOverscanMm: 0,
        },
      ],
    },
  };
  const prepared = preparedProject(project);
  const groups = prepared.job.groups.map((g) => {
    if (g.kind !== 'raster') return g;
    expect(g.sValues.length).toBe(4);
    const values = g.sValues;
    return {
      ...g,
      sValues: new Uint16Array(0),
      rowProvider: (y: number) => values.slice(y * g.pixelWidth, (y + 1) * g.pixelWidth),
    };
  });
  return { ...prepared, job: { ...prepared.job, groups } };
}

describe('new topology metadata across worker, saved Job and exact archive boundaries', () => {
  it('the actual Start preparation worker payload clones parents and preserves emitted bytes after canvas unpacking', async () => {
    const response = await prepareOutputRequest({
      kind: 'start',
      project: archiveTopologyProject(),
      controllerSettings: null,
      machine: {
        statusReport: idle,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok)
      throw new Error('Expected prepared worker result');
    assertNewParents(response.result.prepared.job);
    const cloned = structuredClone(response),
      metadata = parentMetadata(response.result.prepared.job);
    if (cloned.kind !== 'start' || !cloned.result.ok)
      throw new Error('Expected cloned worker result');
    const hydrated = hydrateTransferredStartPreparation(cloned.result);
    if (!hydrated.ok) throw new Error('Expected unpacked Start result');
    expect(parentMetadata(hydrated.prepared.job)).toEqual(metadata);
    expect(emitPreparedGcode(hydrated.prepared).gcode).toBe(response.result.gcode);
  });
  it('plain parent/scope records survive the strict export codec and exact replay never reoptimizes them', async () => {
    const prepared = preparedProject(),
      gcode = emitPreparedGcode(prepared).gcode;
    assertNewParents(prepared.job);
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'topology-codec',
      prepared,
      gcode,
    });
    const decoded = await decodeExecutionArtifactExport(
      await serializeExecutionArtifactExport(artifact),
    );
    expect(parentMetadata(decoded.prepared.job)).toEqual(parentMetadata(prepared.job));
    expect(decoded.fingerprint).toEqual(fingerprintGcode(gcode));
    const optimize = vi.spyOn(optimizer, 'optimizePaths').mockImplementation(() => {
      throw new Error('Archive replay must not optimize');
    });
    expect(recoveryArtifactPreparedProgramMatches(decoded)).toBe(true);
    expect(optimize).not.toHaveBeenCalled();
  });
  it('mixed vector/raster provider hydration retains the original vector parent records and exact program', async () => {
    const prepared = mixedRasterPrepared(),
      gcode = emitPreparedGcode(prepared).gcode;
    assertNewParents(prepared.job);
    const artifact = await createCurrentTestExecutionArtifact({
      runId: 'topology-with-raster',
      prepared,
      gcode,
    });
    const decoded = await decodeExecutionArtifactExport(
      await serializeExecutionArtifactExport(artifact),
    );
    const raster = decoded.prepared.job.groups.find((g) => g.kind === 'raster');
    expect(raster?.kind === 'raster' && raster.archivedRowProviderRecipe).toBe('prepared-project');
    const hydrated = hydratePreparedExecutionOutput(decoded.prepared);
    if (hydrated === null) throw new Error('Raster recipe did not hydrate');
    expect(parentMetadata(hydrated.job)).toEqual(parentMetadata(prepared.job));
    const storedCuts = decoded.prepared.job.groups.filter((g) => g.kind === 'cut');
    expect(
      hydrated.job.groups
        .filter((g) => g.kind === 'cut')
        .every((g, index) => g === storedCuts[index]),
    ).toBe(true);
    expect(emitPreparedGcode(hydrated).gcode).toBe(gcode);
    expect(recoveryArtifactPreparedProgramMatches(decoded)).toBe(true);
  });
  it('a v16 sealed heterogeneous-pass Job without new markers still reproduces fixed old bytes under the new emitter revision', async () => {
    const project = repeatedPowerProject(),
      job = optimizer.optimizePaths(
        historicalNestingJob(),
        topologyOptimization,
        [],
        project.device.origin,
      );
    const prepared = { ok: true, project, job, jobOriginOffset: { x: 0, y: 0 } } satisfies Prepared;
    const oldBytes = PRE_K1_BYTES['historical-nesting'];
    expect(emitPreparedGcode(prepared).gcode).toBe(oldBytes);
    const current = await createCurrentTestExecutionArtifact({
      runId: 'pre-k1-sealed-job',
      prepared,
      gcode: oldBytes,
    });
    if (current.provenance?.schemaVersion !== 2)
      throw new Error('Expected current integrity envelope');
    const { envelopeSha256: _oldEnvelope, ...unsigned } = current.provenance;
    const historical = { ...unsigned, build: { ...unsigned.build, emitterRevision: oldRevision } };
    const archived = {
      ...current,
      provenance: {
        ...historical,
        envelopeSha256: await computeExecutionProvenanceEnvelopeSha256(historical),
      },
    };
    expect(EMITTER_REVISION).not.toBe(oldRevision);
    const decoded = await decodeExecutionArtifactExport(
      await serializeExecutionArtifactExport(archived),
    );
    expect(decoded.provenance?.build.emitterRevision).toBe(oldRevision);
    expect(decoded.gcode).toBe(oldBytes);
    expect(decoded.fingerprint).toEqual(PRE_K1_FINGERPRINTS['historical-nesting']);
    expect(recoveryArtifactPreparedProgramMatches(decoded)).toBe(true);
    const altered = {
      ...decoded,
      prepared: {
        ...decoded.prepared,
        job: { ...decoded.prepared.job, groups: [...decoded.prepared.job.groups].reverse() },
      },
    };
    expect(recoveryArtifactPreparedProgramMatches(altered)).toBe(false);
  });
});
