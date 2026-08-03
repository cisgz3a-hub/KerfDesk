import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../../core/gcode-view';
import type * as Viewer3dModule from '../viewer3d';
import { useViewer3dScene, type Viewer3dSceneBinding } from './use-viewer3d-scene';

const sceneMocks = vi.hoisted(() => ({
  createViewer3dScene: vi.fn(),
  setSegments: vi.fn(),
  fitToBounds: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../viewer3d', async (importOriginal) => {
  const actual = await importOriginal<typeof Viewer3dModule>();
  return { ...actual, createViewer3dScene: sceneMocks.createViewer3dScene };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FIRST_PROGRAM = ['G21 G90', 'M3 S500', 'G0 X10 Y0', 'G1 X20 Y0 F600'].join('\n');
const SECOND_PROGRAM = ['G21 G90', 'M3 S500', 'G0 X0 Y0', 'G1 X40 Y30 F900'].join('\n');
const NO_WEBGL_REASON = 'no context';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
// Written between renders, so the harness holds a mutable cell rather than
// React's readonly RefObject; it is structurally what the hook reads.
const canvasRef: { current: HTMLCanvasElement | null } = { current: null };

function handle(): Viewer3dModule.Viewer3dSceneHandle {
  return {
    setSegments: sceneMocks.setSegments,
    fitToBounds: sceneMocks.fitToBounds,
    setTravelVisible: vi.fn(),
    setPlayhead: vi.fn(),
    setLiveMachine: vi.fn(),
    recolor: vi.fn(),
    setView: vi.fn(),
    captureImage: vi.fn(() => ''),
    setDirectionArrows: vi.fn(),
    resize: vi.fn(),
    requestRender: vi.fn(),
    dispose: sceneMocks.dispose,
  };
}

function renderModel(text: string): GcodeRenderModel {
  const result = buildGcodeRenderModel(text);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

// The hook's binding is what the Inspector renders from, so the harness keeps
// the latest one: asserting only on the scene mocks cannot see a state or
// reason the hook failed to report.
let binding: Viewer3dSceneBinding | null = null;

function Probe(props: { readonly model: GcodeRenderModel }): null {
  binding = useViewer3dScene(canvasRef, props.model);
  return null;
}

async function mount(model: GcodeRenderModel): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<Probe model={model} />);
  });
}

async function rerender(model: GcodeRenderModel): Promise<void> {
  await act(async () => {
    root?.render(<Probe model={model} />);
  });
}

beforeEach(() => {
  binding = null;
  canvasRef.current = document.createElement('canvas');
  sceneMocks.createViewer3dScene.mockReset();
  sceneMocks.createViewer3dScene.mockImplementation(async () => ({
    kind: 'ok' as const,
    handle: handle(),
  }));
  sceneMocks.setSegments.mockClear();
  sceneMocks.fitToBounds.mockClear();
  sceneMocks.dispose.mockClear();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  canvasRef.current = null;
});

describe('useViewer3dScene', () => {
  it('creates one scene and draws the program into it', async () => {
    const model = renderModel(FIRST_PROGRAM);
    await mount(model);

    expect(sceneMocks.createViewer3dScene).toHaveBeenCalledTimes(1);
    expect(sceneMocks.setSegments).toHaveBeenCalledWith(model);
    expect(sceneMocks.fitToBounds).toHaveBeenCalledWith(model.stats.motionBounds);
  });

  // The WebGL context belongs to the canvas, not to the program: rebuilding
  // it per model threw away shaders and buffers for a swap the handle already
  // does in place.
  it('swaps the program in place instead of rebuilding the renderer', async () => {
    await mount(renderModel(FIRST_PROGRAM));
    sceneMocks.setSegments.mockClear();
    sceneMocks.fitToBounds.mockClear();

    const next = renderModel(SECOND_PROGRAM);
    await rerender(next);

    expect(sceneMocks.createViewer3dScene).toHaveBeenCalledTimes(1);
    expect(sceneMocks.dispose).not.toHaveBeenCalled();
    expect(sceneMocks.setSegments).toHaveBeenCalledWith(next);
    expect(sceneMocks.fitToBounds).toHaveBeenCalledWith(next.stats.motionBounds);
  });

  it('does not redraw when the same model renders again', async () => {
    const model = renderModel(FIRST_PROGRAM);
    await mount(model);
    sceneMocks.setSegments.mockClear();

    await rerender(model);

    expect(sceneMocks.setSegments).not.toHaveBeenCalled();
  });

  it('disposes the scene on unmount', async () => {
    await mount(renderModel(FIRST_PROGRAM));

    if (root !== null) await act(async () => root?.unmount());
    root = null;

    expect(sceneMocks.dispose).toHaveBeenCalledTimes(1);
  });

  it('reports the reason when WebGL is unavailable', async () => {
    sceneMocks.createViewer3dScene.mockImplementation(async () => ({
      kind: 'no-webgl' as const,
      reason: NO_WEBGL_REASON,
    }));

    await mount(renderModel(FIRST_PROGRAM));

    expect(binding?.state).toBe('no-webgl');
    expect(binding?.reason).toBe(NO_WEBGL_REASON);
    expect(sceneMocks.setSegments).not.toHaveBeenCalled();
  });
});
