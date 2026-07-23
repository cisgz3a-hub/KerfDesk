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
      result: { gcode: 'G21\n', preflight: { ok: true, issues: [] } },
    });

    await expect(pending).resolves.toEqual({
      gcode: 'G21\n',
      preflight: { ok: true, issues: [] },
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
