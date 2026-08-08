import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type * as Viewer3dModule from '../viewer3d';
import { useSceneSync } from './use-scene-sync';
import { useViewer3dScene, type Viewer3dSceneBinding } from './use-viewer3d-scene';

const SCENE_MOCKS = vi.hoisted(() => ({
  createViewer3dScene: vi.fn(),
  setSegments: vi.fn(),
  fitToBounds: vi.fn(),
  setPlayhead: vi.fn(),
  setLiveMachine: vi.fn(),
  recolor: vi.fn(),
  setDirectionArrows: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof Viewer3dModule>();
  return { ...actual, createViewer3dScene: SCENE_MOCKS.createViewer3dScene };
});

// React's test act flag is intentionally absent from the globalThis type.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_PROGRAM = ['G21 G90', 'M3 S500', 'G0 X10 Y0', 'G1 X20 Y0 F600'].join('\n');
const SECOND_PROGRAM = ['G21 G90', 'M3 S500', 'G0 X0 Y0', 'G1 X40 Y30 F900'].join('\n');
const NO_WEBGL_REASON = 'no context';
const COLOR_OF = (): readonly [number, number, number] => [1, 0, 0];

type SceneHarness = {
  readonly getBinding: () => Viewer3dSceneBinding | null;
  readonly rerender: (model: GcodeRenderModel) => Promise<void>;
  readonly unmount: () => Promise<void>;
};

function handle(): Viewer3dModule.Viewer3dSceneHandle {
  return {
    setSegments: SCENE_MOCKS.setSegments,
    fitToBounds: SCENE_MOCKS.fitToBounds,
    setTravelVisible: vi.fn(),
    setPlayhead: SCENE_MOCKS.setPlayhead,
    setLiveMachine: SCENE_MOCKS.setLiveMachine,
    recolor: SCENE_MOCKS.recolor,
    setView: vi.fn(),
    captureImage: vi.fn(() => ''),
    setDirectionArrows: SCENE_MOCKS.setDirectionArrows,
    resize: vi.fn(),
    requestRender: vi.fn(),
    dispose: SCENE_MOCKS.dispose,
  };
}

function renderModel(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

async function withMountedScene(
  model: GcodeRenderModel,
  run: (harness: SceneHarness) => void | Promise<void>,
): Promise<void> {
  const host = document.createElement('div');
  const canvasRef: { current: HTMLCanvasElement | null } = {
    current: document.createElement('canvas'),
  };
  let binding: Viewer3dSceneBinding | null = null;
  let isMounted = true;
  document.body.appendChild(host);
  const root = createRoot(host);

  function Probe(props: { readonly model: GcodeRenderModel }): null {
    const nextBinding = useViewer3dScene(canvasRef, props.model);
    useSceneSync({
      handleRef: nextBinding.handleRef,
      state: nextBinding.state,
      playhead: null,
      colorOf: COLOR_OF,
      live: null,
      arrows: null,
    });
    binding = nextBinding;
    return null;
  }

  const harness: SceneHarness = {
    getBinding: () => binding,
    rerender: async (nextModel) => {
      await act(async () => root.render(<Probe model={nextModel} />));
    },
    unmount: async () => {
      if (!isMounted) return;
      isMounted = false;
      await act(async () => root.unmount());
    },
  };

  try {
    await act(async () => root.render(<Probe model={model} />));
    await run(harness);
  } finally {
    await harness.unmount();
    host.remove();
  }
}

beforeEach(() => {
  SCENE_MOCKS.createViewer3dScene.mockReset();
  SCENE_MOCKS.createViewer3dScene.mockImplementation(async () => ({
    kind: 'ok' as const,
    handle: handle(),
  }));
  SCENE_MOCKS.setSegments.mockReset();
  SCENE_MOCKS.fitToBounds.mockReset();
  SCENE_MOCKS.setPlayhead.mockReset();
  SCENE_MOCKS.setLiveMachine.mockReset();
  SCENE_MOCKS.recolor.mockReset();
  SCENE_MOCKS.setDirectionArrows.mockReset();
  SCENE_MOCKS.dispose.mockClear();
});

describe('useViewer3dScene', () => {
  it('creates one scene and draws the program into it', async () => {
    const model = renderModel(FIRST_PROGRAM);
    await withMountedScene(model, ({ getBinding }) => {
      expect(SCENE_MOCKS.createViewer3dScene).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.setSegments).toHaveBeenCalledWith(model);
      expect(SCENE_MOCKS.fitToBounds).toHaveBeenCalledWith(model.stats.motionBounds);
      expect(getBinding()?.state).toBe('ready');
    });
  });

  it('publishes ready only after the initial geometry is installed', async () => {
    SCENE_MOCKS.setSegments.mockImplementation(() => {
      expect(SCENE_MOCKS.setPlayhead).not.toHaveBeenCalled();
      expect(SCENE_MOCKS.setLiveMachine).not.toHaveBeenCalled();
      expect(SCENE_MOCKS.recolor).not.toHaveBeenCalled();
      expect(SCENE_MOCKS.setDirectionArrows).not.toHaveBeenCalled();
    });

    await withMountedScene(renderModel(FIRST_PROGRAM), ({ getBinding }) => {
      expect(SCENE_MOCKS.setSegments).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.setPlayhead).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.setLiveMachine).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.recolor).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.setDirectionArrows).toHaveBeenCalledTimes(1);
      expect(getBinding()?.state).toBe('ready');
    });
  });

  it('swaps the program in place instead of rebuilding the renderer', async () => {
    await withMountedScene(renderModel(FIRST_PROGRAM), async ({ rerender }) => {
      SCENE_MOCKS.setSegments.mockClear();
      SCENE_MOCKS.fitToBounds.mockClear();

      const next = renderModel(SECOND_PROGRAM);
      await rerender(next);

      expect(SCENE_MOCKS.createViewer3dScene).toHaveBeenCalledTimes(1);
      expect(SCENE_MOCKS.dispose).not.toHaveBeenCalled();
      expect(SCENE_MOCKS.setSegments).toHaveBeenCalledWith(next);
      expect(SCENE_MOCKS.fitToBounds).toHaveBeenCalledWith(next.stats.motionBounds);
    });
  });

  it('does not redraw when the same model renders again', async () => {
    const model = renderModel(FIRST_PROGRAM);
    await withMountedScene(model, async ({ rerender }) => {
      SCENE_MOCKS.setSegments.mockClear();
      await rerender(model);
      expect(SCENE_MOCKS.setSegments).not.toHaveBeenCalled();
    });
  });

  it('disposes the scene on unmount', async () => {
    await withMountedScene(renderModel(FIRST_PROGRAM), async ({ unmount }) => {
      await unmount();
      expect(SCENE_MOCKS.dispose).toHaveBeenCalledTimes(1);
    });
  });

  it('reports the reason when WebGL is unavailable', async () => {
    SCENE_MOCKS.createViewer3dScene.mockImplementation(async () => ({
      kind: 'no-webgl' as const,
      reason: NO_WEBGL_REASON,
    }));

    await withMountedScene(renderModel(FIRST_PROGRAM), ({ getBinding }) => {
      expect(getBinding()?.state).toBe('no-webgl');
      expect(getBinding()?.reason).toBe(NO_WEBGL_REASON);
      expect(SCENE_MOCKS.setSegments).not.toHaveBeenCalled();
    });
  });
});
