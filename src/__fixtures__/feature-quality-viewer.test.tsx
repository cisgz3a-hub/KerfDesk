// Viewer lifecycle regression extracted from the feature controller audit.
// WebGL is simulated; the asynchronous Inspector lifecycle is real.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../core/scene';
import { useStore } from '../ui/state/store';
import { useUiStore } from '../ui/state/ui-store';
import { InspectorView } from '../ui/gcode-inspector/InspectorView';
import { inspectGcodeText } from '../ui/gcode-inspector/gcode-inspector-parse';
import type * as Viewer3dModule from '../ui/viewer3d';

const mocks = vi.hoisted(() => ({ createScene: vi.fn() }));
vi.mock('../ui/viewer3d', async (load) => ({
  ...(await load<typeof Viewer3dModule>()),
  createViewer3dScene: mocks.createScene,
}));

const initialApp = useStore.getState();
const initialUi = useUiStore.getState();
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
}

beforeEach(() => {
  useStore.setState({ project: createProject() });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  useStore.setState(initialApp, true);
  useUiStore.setState(initialUi, true);
  vi.restoreAllMocks();
});

describe('feature viewer lifecycle regressions', () => {
  it('applies the latest travel visibility when the asynchronous scene becomes ready', async () => {
    const scene = deferred<Viewer3dModule.Viewer3dSceneResult>();
    mocks.createScene.mockReturnValue(scene.promise);
    const program = 'G21 G90\nM3 S500\nG0 X10 Y0\nG1 X20 Y0 F600';
    const result = inspectGcodeText(program);
    if (result.parsed.kind !== 'ok' || result.analysis === null)
      throw new Error('fixture parse failed');
    const model = result.parsed.model;
    const analysis = result.analysis;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const setTravelVisible = vi.fn();
    const handle: Viewer3dModule.Viewer3dSceneHandle = {
      setSegments: vi.fn(),
      setCameraTracking: vi.fn(),
      onCameraInteraction: vi.fn(),
      fitToBounds: vi.fn(),
      setTravelVisible,
      setPlayhead: vi.fn(),
      setLiveMachine: vi.fn(),
      recolor: vi.fn(),
      setView: vi.fn(),
      fitView: vi.fn(),
      setProjection: vi.fn(),
      onProjectionChange: vi.fn(),
      setStage: vi.fn(),
      pickViewCube: vi.fn(() => null),
      hoverViewCube: vi.fn(),
      pickMove: vi.fn(() => null),
      highlightMove: vi.fn(),
      setMoveFilter: vi.fn(),
      setClipPlanes: vi.fn(),
      onCameraMoving: vi.fn(),
      captureImage: vi.fn(() => ''),
      setDirectionArrows: vi.fn(),
      resize: vi.fn(),
      requestRender: vi.fn(),
      prepareToShow: vi.fn(async () => undefined),
      dispose: vi.fn(),
    };
    try {
      await act(async () =>
        root.render(
          <InspectorView
            model={model}
            analysis={analysis}
            source={{ kind: 'text', text: program }}
            sourceIndex={result.sourceIndex}
          />,
        ),
      );
      const toggle = [...host.querySelectorAll('input')].find(
        (input) => input.title === 'Show or hide the non-cutting moves between shapes',
      );
      if (!toggle) throw new Error('travel control missing');
      await act(async () => toggle.click());
      expect(toggle.checked).toBe(false);
      await act(async () => {
        scene.resolve({ kind: 'ok', handle });
        await flush();
      });
      expect(host.querySelector('[data-viewer-state]')?.getAttribute('data-viewer-state')).toBe(
        'ready',
      );
      expect(toggle.checked).toBe(false);
      expect(setTravelVisible).toHaveBeenLastCalledWith(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
