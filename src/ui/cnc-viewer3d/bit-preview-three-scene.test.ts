import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CncTool } from '../../core/scene';
import { bitPreviewProfile } from './bit-preview-profile';
import { createBitPreviewThreeScene, type BitPreviewThreeModule } from './bit-preview-three-scene';
import { buildToolMesh } from './viewer3d-tool';

const meshSpies = vi.hoisted(() => ({
  dispose: vi.fn(),
  object: { name: 'tool-mesh' },
}));

vi.mock('./viewer3d-tool', () => ({
  buildToolMesh: vi.fn(() => ({ object: meshSpies.object, dispose: meshSpies.dispose })),
}));

const rendererSpies = {
  dispose: vi.fn(),
  render: vi.fn(),
  setClearColor: vi.fn(),
  setPixelRatio: vi.fn(),
  setSize: vi.fn(),
};
const sceneSpies = { add: vi.fn(), remove: vi.fn() };
const cameraSpies = { lookAt: vi.fn(), positionSet: vi.fn(), upSet: vi.fn() };
const lightPositionSet = vi.fn();
let rendererShouldThrow = false;

class FakeRenderer {
  constructor() {
    if (rendererShouldThrow) throw new Error('no WebGL context');
  }

  readonly dispose = rendererSpies.dispose;
  readonly render = rendererSpies.render;
  readonly setClearColor = rendererSpies.setClearColor;
  readonly setPixelRatio = rendererSpies.setPixelRatio;
  readonly setSize = rendererSpies.setSize;
}

class FakeScene {
  readonly add = sceneSpies.add;
  readonly remove = sceneSpies.remove;
}

class FakeCamera {
  readonly lookAt = cameraSpies.lookAt;
  readonly position = { set: cameraSpies.positionSet };
  readonly up = { set: cameraSpies.upSet };
}

class FakeLight {
  readonly position = { set: lightPositionSet };
}

const fakeThree = {
  AmbientLight: FakeLight,
  DirectionalLight: FakeLight,
  PerspectiveCamera: FakeCamera,
  Scene: FakeScene,
  WebGLRenderer: FakeRenderer,
} as unknown as BitPreviewThreeModule;

const tool: CncTool = {
  id: 'v90-hobby',
  name: '90 degree V-bit',
  kind: 'v-bit',
  diameterMm: 12.7,
  tipAngleDeg: 90,
  shankDiameterMm: 6.35,
};

let animationFrames: Map<number, FrameRequestCallback>;
let nextFrameId: number;

beforeEach(() => {
  vi.clearAllMocks();
  rendererShouldThrow = false;
  animationFrames = new Map();
  nextFrameId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      nextFrameId += 1;
      animationFrames.set(nextFrameId, callback);
      return nextFrameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((frameId: number) => animationFrames.delete(frameId)),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe('createBitPreviewThreeScene', () => {
  it('renders the truthful profile and releases animation, mesh, and renderer resources', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 180;
    canvas.height = 132;
    const result = await createBitPreviewThreeScene(canvas, tool, vi.fn(), async () => fakeThree);

    expect(result.kind).toBe('ok');
    expect(buildToolMesh).toHaveBeenCalledWith(fakeThree, bitPreviewProfile(tool), {
      x: 0,
      y: 0,
      z: 0,
    });
    expect(rendererSpies.render).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    animationFrames.get(1)?.(16);
    expect(rendererSpies.render).toHaveBeenCalledTimes(2);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

    if (result.kind !== 'ok') throw new Error('expected a scene handle');
    result.handle.dispose();
    result.handle.dispose();
    expect(cancelAnimationFrame).toHaveBeenCalledWith(2);
    expect(sceneSpies.remove).toHaveBeenCalledTimes(3);
    expect(sceneSpies.remove).toHaveBeenNthCalledWith(1, meshSpies.object);
    expect(sceneSpies.remove).toHaveBeenNthCalledWith(2, expect.any(FakeLight));
    expect(sceneSpies.remove).toHaveBeenNthCalledWith(3, expect.any(FakeLight));
    expect(meshSpies.dispose).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
  });

  it('releases every acquired resource when initial rendering fails', async () => {
    rendererSpies.render.mockImplementationOnce(() => {
      throw new Error('GPU render failed');
    });

    await expect(
      createBitPreviewThreeScene(
        document.createElement('canvas'),
        tool,
        vi.fn(),
        async () => fakeThree,
      ),
    ).rejects.toThrow('GPU render failed');

    expect(sceneSpies.remove).toHaveBeenCalledTimes(3);
    expect(meshSpies.dispose).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('renders a static frame when reduced motion is requested', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );

    const result = await createBitPreviewThreeScene(
      document.createElement('canvas'),
      tool,
      vi.fn(),
      async () => fakeThree,
    );

    expect(result.kind).toBe('ok');
    expect(rendererSpies.render).toHaveBeenCalledTimes(1);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    if (result.kind === 'ok') result.handle.dispose();
  });

  it('returns a typed fallback when the WebGL renderer cannot start', async () => {
    rendererShouldThrow = true;

    const result = await createBitPreviewThreeScene(
      document.createElement('canvas'),
      tool,
      vi.fn(),
      async () => fakeThree,
    );

    expect(result).toEqual({ kind: 'no-webgl', reason: 'no WebGL context' });
    expect(buildToolMesh).not.toHaveBeenCalled();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

  it('reports and cleans up a render failure after the scene has started', async () => {
    const onRuntimeFailure = vi.fn();
    const result = await createBitPreviewThreeScene(
      document.createElement('canvas'),
      tool,
      onRuntimeFailure,
      async () => fakeThree,
    );
    rendererSpies.render.mockImplementationOnce(() => {
      throw new Error('GPU frame failed');
    });

    animationFrames.get(1)?.(16);

    expect(onRuntimeFailure).toHaveBeenCalledWith('3D preview rendering stopped: GPU frame failed');
    expect(meshSpies.dispose).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
    if (result.kind === 'ok') result.handle.dispose();
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
  });

  it('reports and cleans up a WebGL context loss after startup', async () => {
    const canvas = document.createElement('canvas');
    const onRuntimeFailure = vi.fn();
    const result = await createBitPreviewThreeScene(
      canvas,
      tool,
      onRuntimeFailure,
      async () => fakeThree,
    );

    canvas.dispatchEvent(new Event('webglcontextlost'));

    expect(onRuntimeFailure).toHaveBeenCalledWith('The WebGL context was lost.');
    expect(meshSpies.dispose).toHaveBeenCalledTimes(1);
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
    if (result.kind === 'ok') result.handle.dispose();
    expect(rendererSpies.dispose).toHaveBeenCalledTimes(1);
  });
});
