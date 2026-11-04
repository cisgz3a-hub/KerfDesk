import { IDBFactory as FakeIDBFactory, IDBKeyRange as FakeIDBKeyRange } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rotaryRasterSaveProject } from '../../__fixtures__/rotary-raster-save-project';
import type { StatusReport } from '../../core/controllers/grbl';
import { computeJobBounds, computeJobMotionBounds } from '../../core/job';
import { DEFAULT_JOB_PLACEMENT } from '../job-placement';
import {
  DEFAULT_OUTPUT_SCOPE,
  IDENTITY_TRANSFORM,
  addLayer,
  addObject,
  createLayer,
  createProject,
  type Project,
} from '../../core/scene';
import { emitPreparedGcode } from '../../io/gcode';
import { buildMotionManifest } from '../../core/job/motion-manifest';
import { hydratePreparedExecutionOutput } from '../../io/gcode/prepared-output-persistence';
import { canvasExecutablePlan } from '../state/canvas-preview-motion';
import { selectExecutablePlanCalculatedBounds } from './executable-plan-calculated-bounds';
import { PagedAssetByteWriter } from '../import/paged-asset-byte-writer';
import { IndexedDbPagedAssetRepository } from '../import/paged-asset-indexeddb';
import { prepareOutputRequest } from './output-preparation';
import { hydrateTransferredStartPreparation } from './output-preparation-worker-client';
import { frameVerificationForProject } from './frame-verification-testing';
import {
  preparedStartFrameBounds,
  requiredFrameIssueFromPrepared,
} from './required-frame-readiness';

const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  wco: null,
};
const MISSING_OBJECT_ID = 'missing-object';

describe('output preparation worker payload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preserves a failed Save preparation as a distinct worker result', async () => {
    const response = await prepareOutputRequest({
      kind: 'save',
      project: createProject(),
      options: {
        outputScope: {
          cutSelectedGraphics: true,
          useSelectionOrigin: false,
          selectedObjectIds: [MISSING_OBJECT_ID],
        },
      },
    });

    expect(response).toMatchObject({
      kind: 'save',
      result: {
        kind: 'preparation-failed',
        gcode: '',
        preflight: { issues: [{ code: 'selected-output-empty' }] },
      },
    });
    expect(() => structuredClone(response)).not.toThrow();
  });

  it('returns cloneable rotary raster output without a permission field', async () => {
    const defaultResponse = await prepareOutputRequest({
      kind: 'save',
      project: rotaryRasterSaveProject(),
      options: {},
    });

    expect(defaultResponse).toMatchObject({
      kind: 'save',
      result: { kind: 'emitted', preflight: { issues: [] } },
    });
    if (defaultResponse.kind !== 'save') throw new Error('Save did not prepare.');
    expect(defaultResponse.result.gcode).not.toBe('');
    expect(() => structuredClone(defaultResponse)).not.toThrow();
  });

  it('returns an exact cloneable large Start result without a function-valued raster', async () => {
    const project = streamedProject();
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });

    expect(response.kind).toBe('start');
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const raster = response.result.prepared.job.groups.find((group) => group.kind === 'raster');
    expect(raster?.kind === 'raster' ? raster.rowProvider : undefined).toBeUndefined();
    expect(raster?.kind === 'raster' ? raster.archivedRowProviderRecipe : undefined).toBe(
      'prepared-project',
    );
    expect(response.result.metrics.jobBounds).not.toBeNull();
    expect(() => structuredClone(response)).not.toThrow();

    const hydrated = hydratePreparedExecutionOutput(response.result.prepared);
    expect(hydrated).not.toBeNull();
    expect(
      emitPreparedGcode(hydrated ?? response.result.prepared, {
        outputScope: DEFAULT_OUTPUT_SCOPE,
      }).gcode,
    ).toBe(response.result.gcode);
  });

  // ADR-244 Amendment 3 moved the manifest into columns and the program's line
  // scans off split('\n'); neither may change a byte or a block.
  it.each([
    ['a streamed photo', streamedProject],
    ['a Fill job', fillProject],
  ])('emits the bytes Save writes for %s and hands its motion over intact', async (_name, make) => {
    const project = make();
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: { statusReport: IDLE, alarmCode: null, hasActiveStreamer: false },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const sealed = hydratePreparedExecutionOutput(response.result.prepared);
    expect(
      emitPreparedGcode(sealed ?? response.result.prepared, { outputScope: DEFAULT_OUTPUT_SCOPE })
        .gcode,
    ).toBe(response.result.gcode);
    // Past 4,096 blocks the plan crosses as packed columns.
    expect('encoding' in response.result.canvasPlan.manifest).toBe(true);
    const received = hydrateTransferredStartPreparation(structuredClone(response.result));
    if (!received.ok) throw new Error('Start did not hydrate.');
    const parsed = buildMotionManifest(response.result.gcode, {
      machineKind: 'laser',
      initialPosition: { x: 0, y: 0, z: 0 },
    });
    expect(Array.from(received.canvasPlan.manifest.blocks)).toEqual(Array.from(parsed.blocks));
    expect(parsed.blocks.length).toBeGreaterThan(4_096);
  });

  // The bed-sized photo of performance audit S4 (S4-P2-2): its Start review
  // revoked the Frame it had just matched, because the window measured a job
  // whose streamed rows had stayed in the worker.
  it('passes the frame-first gate of a streamed image with the bounds the worker measured', async () => {
    const project = streamedProject();
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const hydrated = hydrateTransferredStartPreparation(response.result);
    if (!hydrated.ok) throw new Error('Start did not hydrate.');
    const machine = { frameVerification: frameVerificationForProject(project) };

    // Measured again on this side, the image has no rows and no bounds.
    expect(requiredFrameIssueFromPrepared({ prepared: hydrated.prepared, machine })).not.toBeNull();
    expect(
      requiredFrameIssueFromPrepared({
        prepared: hydrated.prepared,
        machine,
        measuredFrameBounds: preparedStartFrameBounds(hydrated),
      }),
    ).toBeNull();
  });

  it('rehydrates each angle of a cross-hatched streamed image to the sealed bytes', async () => {
    const base = streamedProject();
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer) =>
          layer.mode === 'image'
            ? { ...layer, imageScanAngleDeg: 30, imageCrossHatch: true }
            : layer,
        ),
      },
    };
    const response = await prepareOutputRequest({
      kind: 'start',
      project,
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });

    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const rasters = response.result.prepared.job.groups.filter((group) => group.kind === 'raster');
    expect(rasters.map((group) => (group.kind === 'raster' ? group.scanAngleDeg : null))).toEqual([
      30, 120,
    ]);
    const hydrated = hydratePreparedExecutionOutput(response.result.prepared);
    expect(hydrated).not.toBeNull();
    expect(
      emitPreparedGcode(hydrated ?? response.result.prepared, {
        outputScope: DEFAULT_OUTPUT_SCOPE,
      }).gcode,
    ).toBe(response.result.gcode);
  });

  it('uses the same verified plan for calculated bounds without changing emitted bytes', async () => {
    const response = await prepareOutputRequest({
      kind: 'start',
      project: fullBedLineProject(),
      controllerSettings: null,
      machine: {
        statusReport: IDLE,
        alarmCode: null,
        hasActiveStreamer: false,
        settingsCapability: 'none',
      },
      jobPlacement: DEFAULT_JOB_PLACEMENT,
      outputScope: DEFAULT_OUTPUT_SCOPE,
      requireFrame: false,
    });

    expect(response.kind).toBe('start');
    if (response.kind !== 'start' || !response.result.ok) throw new Error('Start did not prepare.');
    const hydratedResult = hydrateTransferredStartPreparation(response.result);
    if (!hydratedResult.ok) throw new Error('Start did not hydrate.');
    const { prepared, canvasPlan, gcode, metrics } = hydratedResult;
    const plan = canvasExecutablePlan(canvasPlan);
    expect(plan).toBeDefined();
    if (plan === undefined) return;
    const selected = selectExecutablePlanCalculatedBounds({
      legacyJobBounds: computeJobBounds(prepared.job, prepared.project.device),
      legacyMotionBounds: computeJobMotionBounds(prepared.job, prepared.project.device),
      executablePlan: plan,
      rotaryApplies: false,
    });

    expect(selected.source).toBe('executable-plan');
    expect(metrics.jobBounds).toEqual(selected.jobBounds);
    expect(metrics.motionBounds).toEqual(selected.motionBounds);
    expect(plan.compatibility.exactProgram).toBe(gcode);
    expect(emitPreparedGcode(prepared).gcode).toBe(gcode);
  });

  it('hydrates page-backed luma before the production Save preparation emits G-code', async () => {
    const factory = new FakeIDBFactory();
    vi.stubGlobal('indexedDB', factory);
    vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
    vi.stubGlobal('Blob', NodeBlob);
    const repository = new IndexedDbPagedAssetRepository(factory, FakeIDBKeyRange);
    const writer = await PagedAssetByteWriter.create(repository, {
      assetId: 'worker-luma',
      sourceName: 'large.png.luma',
      mimeType: 'application/x-curvedesk-luma',
      byteLength: 2,
      createdAtEpochMs: 1,
      pageBytes: 1,
    });
    await writer.write(Uint8Array.of(0, 255));
    await writer.finish();

    const response = await prepareOutputRequest({
      kind: 'save',
      project: pageBackedProject(),
      options: {},
    });
    const embedded = await prepareOutputRequest({
      kind: 'save',
      project: embeddedRasterProject(),
      options: {},
    });

    expect(response).toEqual(embedded);
    expect(response.kind === 'save' ? response.result.gcode : '').toContain('S300');
  });
});

function streamedProject(): Project {
  const base = createProject();
  const color = '#111111';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'raster-image',
        id: 'large-image',
        color,
        source: 'large.png',
        dataUrl: 'data:image/png;base64,source',
        lumaBase64: 'AA==',
        pixelWidth: 1,
        pixelHeight: 1,
        dither: 'threshold',
        linesPerMm: 10,
        bounds: { minX: 0, minY: 0, maxX: 201, maxY: 201 },
        transform: IDENTITY_TRANSFORM,
      }),
      {
        ...createLayer({ id: 'image', color, mode: 'image' }),
        linesPerMm: 10,
        ditherAlgorithm: 'threshold',
        fillOverscanMm: 0,
      },
    ),
  };
}

function fillProject(): Project {
  const base = createProject();
  const color = '#2255ff';
  const square = (size: number) => ({
    points: [
      { x: 5, y: 5 },
      { x: 5 + size, y: 5 },
      { x: 5 + size, y: 5 + size },
      { x: 5, y: 5 + size },
    ],
    closed: true,
  });
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'fill',
        source: 'fill.svg',
        bounds: { minX: 5, minY: 5, maxX: 255, maxY: 255 },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color, polylines: [square(250)] }],
      }),
      { ...createLayer({ id: 'fill', color, mode: 'fill' }), linesPerMm: 10 },
    ),
  };
}

function fullBedLineProject(): Project {
  const base = createProject();
  const color = '#222222';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'imported-svg',
        id: 'full-bed-line',
        source: 'full-bed-line.svg',
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: base.device.bedHeight },
        transform: IDENTITY_TRANSFORM,
        paths: [
          {
            color,
            polylines: [
              {
                closed: false,
                points: [
                  { x: 0, y: 0 },
                  { x: 0, y: base.device.bedHeight },
                ],
              },
            ],
          },
        ],
      }),
      createLayer({ id: color, color, mode: 'line' }),
    ),
  };
}

function pageBackedProject(): Project {
  return rasterProject({
    imageAsset: {
      schemaVersion: 1,
      repository: 'curvedesk-import-assets-v1',
      sourceAssetId: 'worker-source',
      lumaAssetId: 'worker-luma',
      sourceMimeType: 'image/png',
      sourceByteLength: 300_000_000,
      lumaByteLength: 2,
      naturalWidth: 2,
      naturalHeight: 1,
      sampledWidth: 2,
      sampledHeight: 1,
      thumbnail: {
        mimeType: 'image/bmp',
        dataUrl: 'data:image/bmp;base64,thumbnail',
        width: 2,
        height: 1,
      },
    },
  });
}

function embeddedRasterProject(): Project {
  return rasterProject({
    dataUrl: 'data:image/png;base64,source',
    lumaBase64: 'AP8=',
  });
}

function rasterProject(
  source:
    | Pick<Extract<Project['scene']['objects'][number], { kind: 'raster-image' }>, 'imageAsset'>
    | Pick<
        Extract<Project['scene']['objects'][number], { kind: 'raster-image' }>,
        'dataUrl' | 'lumaBase64'
      >,
): Project {
  const base = createProject();
  const color = '#111111';
  return {
    ...base,
    scene: addLayer(
      addObject(base.scene, {
        kind: 'raster-image',
        id: 'image',
        color,
        source: 'image.png',
        ...source,
        pixelWidth: 2,
        pixelHeight: 1,
        dither: 'threshold',
        linesPerMm: 1,
        bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
        transform: IDENTITY_TRANSFORM,
      }),
      {
        ...createLayer({ id: 'image', color, mode: 'image' }),
        linesPerMm: 1,
        ditherAlgorithm: 'threshold',
        fillOverscanMm: 0,
      },
    ),
  };
}
