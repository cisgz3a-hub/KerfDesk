import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import {
  outputPreparationShouldRunOffThread,
  prepareSaveOutputOffThread,
} from './output-preparation-worker-client';
import type {
  OutputPreparationRequest,
  OutputPreparationResponse,
} from './output-preparation-protocol';

const PREPARATION_FAILURE_MESSAGE = 'The output snapshot could not be prepared.';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<OutputPreparationResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: OutputPreparationRequest[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(request: OutputPreparationRequest): void {
    this.posted.push(request);
  }

  terminate(): void {
    this.terminated = true;
  }

  respond(response: OutputPreparationResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<OutputPreparationResponse>);
  }
}

beforeEach(() => vi.stubGlobal('Worker', FakeWorker));
afterEach(() => vi.unstubAllGlobals());

describe('output preparation worker client', () => {
  it('routes pass-amplified vector output off the UI thread', () => {
    expect(outputPreparationShouldRunOffThread(vectorProject({ passes: 100_000 }))).toBe(true);
  });

  it('routes depth-amplified CNC output off the UI thread', () => {
    const project = vectorProject({ passes: 1 });
    const layer = project.scene.layers[0];
    if (layer === undefined) throw new Error('layer missing');
    const cnc: Project = {
      ...project,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...project.scene,
        layers: [
          {
            ...layer,
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              depthMm: 100_000,
              depthPerPassMm: 1,
            },
          },
        ],
      },
    };

    expect(outputPreparationShouldRunOffThread(cnc)).toBe(true);
  });

  it('routes page-backed raster output off the UI thread regardless of sampled size', () => {
    const project = createProject();
    expect(
      outputPreparationShouldRunOffThread({
        ...project,
        scene: {
          ...project.scene,
          objects: [
            {
              kind: 'raster-image',
              id: 'paged',
              source: 'large.png',
              color: '#808080',
              imageAsset: {
                schemaVersion: 1,
                repository: 'curvedesk-import-assets-v1',
                sourceAssetId: 'source-pages',
                lumaAssetId: 'luma-pages',
                sourceMimeType: 'image/png',
                sourceByteLength: 300_000_000,
                lumaByteLength: 1,
                naturalWidth: 1,
                naturalHeight: 1,
                sampledWidth: 1,
                sampledHeight: 1,
                thumbnail: {
                  mimeType: 'image/bmp',
                  dataUrl: 'data:image/bmp;base64,thumbnail',
                  width: 1,
                  height: 1,
                },
              },
              pixelWidth: 1,
              pixelHeight: 1,
              dither: 'threshold',
              linesPerMm: 1,
              bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
              transform: IDENTITY_TRANSFORM,
            },
          ],
        },
      }),
    ).toBe(true);
  });

  it('returns null without Worker support', () => {
    vi.unstubAllGlobals();
    expect(
      prepareSaveOutputOffThread({ kind: 'save', project: createProject(), options: {} }),
    ).toBeNull();
  });

  it('resolves a Save result and terminates the one-shot worker', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error('worker missing');
    worker.respond({
      kind: 'save',
      result: {
        kind: 'emitted',
        gcode: 'G21\n',
        preflight: { ok: true, issues: [] },
        cncVCarveDepths: [{ layerId: 'flowing-v-layer', depthMm: 5.499 }],
      },
    });

    await expect(pending).resolves.toEqual({
      kind: 'emitted',
      gcode: 'G21\n',
      preflight: { ok: true, issues: [] },
      cncVCarveDepths: [{ layerId: 'flowing-v-layer', depthMm: 5.499 }],
    });
    expect(worker.terminated).toBe(true);
  });

  it('preserves a failed Save result and terminates the one-shot worker', async () => {
    const pending = prepareSaveOutputOffThread({
      kind: 'save',
      project: createProject(),
      options: {},
    });
    if (pending === null) throw new Error('worker unavailable');
    const worker = FakeWorker.instances.at(-1);
    if (worker === undefined) throw new Error('worker missing');
    worker.respond({
      kind: 'save',
      result: {
        kind: 'preparation-failed',
        gcode: '',
        preflight: {
          ok: false,
          issues: [
            {
              code: 'variable-evaluation-failed',
              message: PREPARATION_FAILURE_MESSAGE,
            },
          ],
        },
      },
    });

    await expect(pending).resolves.toEqual({
      kind: 'preparation-failed',
      gcode: '',
      preflight: {
        ok: false,
        issues: [
          {
            code: 'variable-evaluation-failed',
            message: PREPARATION_FAILURE_MESSAGE,
          },
        ],
      },
    });
    expect(worker.terminated).toBe(true);
  });
});

function vectorProject(options: { readonly passes: number }): Project {
  const project = createProject();
  const color = '#000000';
  const object: SceneObject = {
    kind: 'shape',
    id: 'shape',
    color,
    spec: { kind: 'rect', widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
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
              { x: 1, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  return {
    ...project,
    scene: {
      objects: [object],
      layers: [{ ...createLayer({ id: 'line', color }), passes: options.passes }],
    },
  };
}
