import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Object3D, type Scene } from 'three';
import type * as ThreeNamespace from 'three';
import type { ReliefSurfaceMeshWithNormals } from '../../core/relief/relief-surface-mesh';
import type { ViewerContentHandle } from '../cnc-viewer3d';
import type {
  Cut3DOffscreenWorkerRequest,
  Cut3DOffscreenWorkerResponse,
} from './cut3d-offscreen-worker-protocol';
import { MESH } from './cut3d-offscreen-worker-test-support';

const mocks = vi.hoisted(() => ({ build: vi.fn(), render: vi.fn() }));
vi.mock('../cnc-viewer3d', () => ({ buildViewerContent: mocks.build }));
vi.mock('./scene-lighting', () => ({ applySceneLighting: () => ({ dispose: vi.fn() }) }));
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof ThreeNamespace>();
  return {
    ...actual,
    WebGLRenderer: class {
      setClearColor = vi.fn();
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = mocks.render;
      getContext = () => ({ isContextLost: () => false });
      dispose = vi.fn();
      forceContextLoss = vi.fn();
    },
  };
});

type Build = {
  readonly mesh: ReliefSurfaceMeshWithNormals;
  readonly stockThicknessMm: number;
  readonly content: ViewerContentHandle;
  readonly finish: () => void;
};
const builds: Build[] = [];
const responses: Cut3DOffscreenWorkerResponse[] = [];
const scope = {
  onmessage: null as ((event: MessageEvent<Cut3DOffscreenWorkerRequest>) => void) | null,
  postMessage: (message: Cut3DOffscreenWorkerResponse) => responses.push(message),
};
const replacement = { ...MESH, positions: new Float32Array([0, 0, -3, 1, 0, -3, 0, 1, -2]) };

beforeEach(async () => {
  vi.resetModules();
  builds.length = 0;
  responses.length = 0;
  mocks.render.mockClear();
  mocks.build.mockImplementation(
    (_three: unknown, input: Pick<Build, 'mesh' | 'stockThicknessMm'>) =>
      new Promise<ViewerContentHandle>((resolve) => {
        const object = new Object3D();
        object.userData = input;
        const content = {
          object,
          surface: object,
          dispose: vi.fn(),
          setScrubMm: vi.fn(),
          setDisplayMode: vi.fn(),
        };
        builds.push({ ...input, content, finish: () => resolve(content) });
      }),
  );
  vi.stubGlobal('self', scope);
  await import('./cut3d-offscreen-worker');
});

afterEach(() => {
  send({ kind: 'dispose', sessionId: 1 });
  vi.unstubAllGlobals();
});

function send(request: Cut3DOffscreenWorkerRequest): void {
  scope.onmessage?.(new MessageEvent('message', { data: request }));
}

async function start(): Promise<Build> {
  send({
    kind: 'init',
    sessionId: 1,
    canvas: new EventTarget() as OffscreenCanvas,
    mesh: MESH,
    stockThicknessMm: 6,
    widthPx: 400,
    heightPx: 300,
    pixelRatio: 1,
  });
  return buildAt(0);
}

async function buildAt(index: number): Promise<Build> {
  await vi.waitFor(() => expect(builds.length).toBeGreaterThan(index));
  return builds[index] as Build;
}

function replace(surfaceId: number, mesh: ReliefSurfaceMeshWithNormals | null, thickness = 6) {
  send({ kind: 'surface', sessionId: 1, surfaceId, mesh, stockThicknessMm: thickness });
}

async function expectShown(build: Build, surfaceId: number): Promise<void> {
  build.finish();
  await vi.waitFor(() =>
    expect(responses).toContainEqual(
      expect.objectContaining({ kind: 'presented', source: 'surface', inputId: surfaceId }),
    ),
  );
  const scene = mocks.render.mock.lastCall?.[0] as Scene;
  expect(scene.children).toContain(build.content.object);
  expect(build.content.object.userData.mesh).toBe(replacement);
  expect(build.content.object.userData.stockThicknessMm).toBe(12);
}

describe('Cut 3D requested surface ownership', () => {
  it('keeps the new mesh when thickness changes before renderer initialization finishes', async () => {
    const initial = await start();
    replace(1, replacement);
    replace(2, null, 12);
    initial.finish();
    const final = await buildAt(1);
    await expectShown(final, 2);
    expect(final.mesh).toBe(replacement);
  });

  it('keeps the requested mesh during an unfinished replacement and disposes stale content', async () => {
    (await start()).finish();
    await vi.waitFor(() => expect(responses).toContainEqual({ kind: 'ready', sessionId: 1 }));
    replace(1, replacement);
    const stale = await buildAt(1);
    replace(2, null, 12);
    const final = await buildAt(2);
    await expectShown(final, 2);
    stale.finish();
    await vi.waitFor(() => expect(stale.content.dispose).toHaveBeenCalledOnce());
    expect(responses).not.toContainEqual(
      expect.objectContaining({ kind: 'presented', source: 'surface', inputId: 1 }),
    );
    expect((mocks.render.mock.lastCall?.[0] as Scene).children).toContain(final.content.object);
  });

  it('disposes an in-flight replacement without presenting it after the session closes', async () => {
    (await start()).finish();
    await vi.waitFor(() => expect(responses).toContainEqual({ kind: 'ready', sessionId: 1 }));
    replace(1, replacement);
    const pending = await buildAt(1);
    send({ kind: 'dispose', sessionId: 1 });
    pending.finish();
    await vi.waitFor(() => expect(pending.content.dispose).toHaveBeenCalledOnce());
    expect(responses).not.toContainEqual(expect.objectContaining({ source: 'surface' }));
  });
});
