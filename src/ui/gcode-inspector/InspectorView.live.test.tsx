import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import type * as Viewer3d from '../viewer3d';
import type { GcodeInspectionSource } from './gcode-inspection-source';
import { analyzeGcodeModel } from './gcode-inspector-analysis';
import { InspectorView } from './InspectorView';
import {
  LIVE_PROGRAM,
  liveInspectorModel,
  liveInspectorState,
} from './inspector-live-test-fixture';

const scene = vi.hoisted(() => ({
  setSegments: vi.fn(),
  fitToBounds: vi.fn(),
  setPlayhead: vi.fn(),
  recolor: vi.fn(),
  setDirectionArrows: vi.fn(),
  setLiveMachine: vi.fn(),
  setCameraTracking: vi.fn(),
  onCameraInteraction: vi.fn(),
  setTravelVisible: vi.fn(),
  setView: vi.fn(),
  captureImage: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('../viewer3d', async (importOriginal) => {
  const original = await importOriginal<typeof Viewer3d>();
  return { ...original, createViewer3dScene: vi.fn(async () => ({ kind: 'ok', handle: scene })) };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const source: GcodeInspectionSource = { kind: 'text', text: LIVE_PROGRAM };
let root: Root;
let host: HTMLDivElement;

async function render(
  nextSource = source,
  model = liveInspectorModel(),
  analysis = analyzeGcodeModel(model),
): Promise<void> {
  await act(async () =>
    root.render(
      <InspectorView variant="preview" model={model} source={nextSource} analysis={analysis} />,
    ),
  );
}

function button(text: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find(
    (element) => element.textContent === text,
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    ...liveInspectorState(),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
});

describe('InspectorView live scene integration', () => {
  it('preserves the preview depth lens and the timeline supplied by worker analysis', async () => {
    const model = liveInspectorModel();
    const analysis = analyzeGcodeModel(model);
    await render(source, model, { ...analysis, time: { ...analysis.time, motionSeconds: 123 } });
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]')?.value).toBe(
      'depth',
    );
    act(() => button('Preview playback').click());
    expect(host.textContent).toContain('2:03 / 2:03');
    const before = scene.recolor.mock.calls.length;
    act(() => {
      const lens = host.querySelector<HTMLSelectElement>('[aria-label="Colour lens"]');
      if (lens === null) throw new Error('Missing preview lens');
      lens.value = 'tool';
      lens.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(scene.recolor.mock.calls.length).toBeGreaterThan(before);
  });

  it('aims the camera at the trusted report while revealing the projected confirmed route', async () => {
    const run = useLaserStore.getState().liveCanvasRun;
    if (run == null) throw new Error('Expected run');
    useLaserStore.setState({ liveCanvasRun: { ...run, reportedHead: { x: 5.2, y: 0.3, z: 0.1 } } });
    await render();
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith({
      mode: 'auto',
      progress: 0.25,
      point: { x: 5.2, y: 0.3, z: 0.1 },
    });
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith({ x: 5.2, y: 0.3, z: 0.1 });
    expect(scene.setPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ point: { x: 5, y: 0, z: 0 }, segmentFraction: 0.5 }),
    );
  });

  it('reveals and follows confirmed motion rather than acknowledged queue percentage', async () => {
    await render();
    expect(scene.setPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({
        segmentIndex: 0,
        segmentFraction: 0.5,
        point: { x: 5, y: 0, z: 0 },
        hideMarker: true,
      }),
    );
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith({
      mode: 'auto',
      progress: 0.25,
      point: { x: 5, y: 0, z: 0 },
    });
    expect(host.querySelector('input[aria-label="Program time"]')).toBeNull();
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
    act(() => {
      const streamer = useLaserStore.getState().streamer;
      if (streamer === null) throw new Error('Expected streamer');
      useLaserStore.setState({
        streamer: { ...streamer, status: 'done', completed: streamer.total },
      });
    });
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('25');
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith({
      mode: 'auto',
      progress: 0.25,
      point: { x: 5, y: 0, z: 0 },
    });
  });

  it('switches to local playback and back without changing controller state', async () => {
    await render();
    const machineBefore = useLaserStore.getState();
    act(() => button('Preview playback').click());
    expect(host.querySelector('input[aria-label="Program time"]')).not.toBeNull();
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith(null);
    act(() => button('Restart').click());
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith({
      mode: 'auto',
      progress: 0,
      point: { x: 0, y: 0, z: 0 },
    });
    act(() => button('Watch live run').click());
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith({ x: 5, y: 0, z: 0 });
    expect(useLaserStore.getState()).toBe(machineBefore);
  });

  it('does not follow the machine while viewing an unrelated source', async () => {
    await render({ kind: 'text', text: `${LIVE_PROGRAM}\n; different source` });
    expect(host.querySelector('[role="progressbar"]')).toBeNull();
    expect(host.querySelector('input[aria-label="Program time"]')).not.toBeNull();
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith(null);
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith(
      expect.objectContaining({ point: null }),
    );
    expect(host.textContent).not.toContain('Preview playback');
  });

  it('retains completed trail while removing the live camera and machine marker', async () => {
    await render();
    act(() => {
      const run = useLaserStore.getState().liveCanvasRun;
      if (run == null) throw new Error('Expected run');
      useLaserStore.setState({
        liveCanvasRun: {
          ...run,
          lifecycle: 'finished',
          route: { ...run.route, confirmedRouteMm: run.plan.manifest.totalRouteMm },
        },
      });
    });
    expect(scene.setCameraTracking).toHaveBeenLastCalledWith({
      mode: 'auto',
      progress: 1,
      point: null,
    });
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith(null);
    expect(scene.setPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ segmentIndex: 1, segmentFraction: 1 }),
    );
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('100');
  });

  it('reapplies the live marker when an equal-position program model replaces geometry', async () => {
    await render();
    const previousCalls = scene.setLiveMachine.mock.calls.length;
    await render();
    expect(scene.setLiveMachine.mock.calls.length).toBeGreaterThan(previousCalls);
    expect(scene.setLiveMachine).toHaveBeenLastCalledWith({ x: 5, y: 0, z: 0 });
    expect(host.querySelector('[aria-label="Viewer position"]')?.textContent).toContain('Line 5');
  });
});
