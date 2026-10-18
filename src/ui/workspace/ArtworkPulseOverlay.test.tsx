import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { ArtworkPulseClock, PULSE_HOVER_DWELL_MS } from './artwork-pulse';
import { ArtworkPulseOverlay } from './ArtworkPulseOverlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const SIZE = { width: 800, height: 600 };
const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };

function project(): Project {
  const heart: ImportedSvg = {
    kind: 'imported-svg',
    id: 'heart',
    source: 'heart.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationIds: ['engrave'],
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
              { x: 0, y: 0 },
            ],
          },
        ],
      },
    ],
  };
  const base = createProject();
  const layers = [createLayer({ id: 'engrave', color: '#2563eb', mode: 'fill' })];
  return { ...base, scene: { ...base.scene, objects: [heart], layers } };
}

let host: HTMLDivElement;
let canvas: HTMLCanvasElement;
let canvasRef: { current: HTMLCanvasElement };
let root: Root;
let hover: MockInstance<ArtworkPulseClock['hover']>;

// Hover off means a click or drag owns the pointer unless a test says otherwise.
async function render(canvasHoverEnabled: boolean, dragging = !canvasHoverEnabled): Promise<void> {
  await act(async () =>
    root.render(
      <ArtworkPulseOverlay
        canvasRef={canvasRef}
        project={useStore.getState().project}
        canvasSize={SIZE}
        viewState={VIEW}
        canvasHoverEnabled={canvasHoverEnabled}
        dragging={dragging}
      />,
    ),
  );
}

// jsdom has no PointerEvent; the overlay only reads pointerId and coordinates.
function withPointerId(event: MouseEvent, pointerId = 1): MouseEvent {
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

async function pointAt(point: { x: number; y: number } | null): Promise<void> {
  await act(async () => useStore.getState().setCursorMm(point));
  await act(async () => vi.advanceTimersByTime(PULSE_HOVER_DWELL_MS + 10));
}

const pulses = (): ReadonlyArray<unknown> =>
  hover.mock.calls.map((call) => (call[2] as { pulse?: boolean } | undefined)?.pulse ?? true);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  hover = vi.spyOn(ArtworkPulseClock.prototype, 'hover');
  useStore.setState({ project: project(), cursorMm: null });
  canvas = document.createElement('canvas');
  canvasRef = { current: canvas };
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: SIZE.width,
    bottom: SIZE.height,
    width: SIZE.width,
    height: SIZE.height,
    toJSON: () => ({}),
  });
  document.body.appendChild(canvas);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  canvas.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useUiStore.setState({ operationColorPeek: false, hoveredOperationId: null });
});

describe('ArtworkPulseOverlay (ADR-620)', () => {
  it('pulses once on hover and resumes without a second pulse after a click', async () => {
    await render(true);
    await pointAt({ x: 5, y: 5 });
    expect(pulses()).toEqual([true]);

    // A click: the press owns the pointer, then pointer-up clears the cursor
    // although the pointer has not moved.
    await render(false);
    await act(async () => useStore.getState().setCursorMm(null));
    await act(async () => {
      canvas.dispatchEvent(
        withPointerId(new MouseEvent('pointerup', { clientX: 50, clientY: 50 })),
      );
      // The browser drops capture after every release; that is still just a click.
      canvas.dispatchEvent(withPointerId(new MouseEvent('lostpointercapture')));
    });
    await render(true);
    expect(pulses()).toEqual([true, false]);

    // The next small move on the same piece is still the same hover.
    await pointAt({ x: 5.5, y: 5 });
    expect(pulses()).toEqual([true, false]);
  });

  it('ends a paused hover when capture is lost without a release (a cancelled drag)', async () => {
    await render(true);
    await pointAt({ x: 5, y: 5 });
    await render(false);
    await act(async () => useStore.getState().setCursorMm(null));
    await act(async () =>
      canvas.dispatchEvent(withPointerId(new MouseEvent('lostpointercapture'))),
    );
    await render(true);
    expect(pulses()).toEqual([true]);
    await pointAt({ x: 5, y: 5 });
    expect(pulses()).toEqual([true, true]);
  });

  it('does not let an uncaptured click mask a later cancelled drag', async () => {
    await render(true);
    await pointAt({ x: 5, y: 5 });
    // A Shift-click selection releases without ever holding capture.
    await act(async () =>
      canvas.dispatchEvent(
        withPointerId(new MouseEvent('pointerup', { clientX: 50, clientY: 50 })),
      ),
    );
    // The next drag with the same mouse is then cancelled.
    await act(async () => canvas.dispatchEvent(withPointerId(new MouseEvent('pointerdown'))));
    await render(false);
    await act(async () => useStore.getState().setCursorMm(null));
    await act(async () =>
      canvas.dispatchEvent(withPointerId(new MouseEvent('lostpointercapture'))),
    );
    await render(true);
    await pointAt({ x: 5, y: 5 });
    expect(pulses()).toEqual([true, true]);
  });

  it('ends the hover when the Select tool is left, rather than pausing it', async () => {
    await render(true);
    await pointAt({ x: 5, y: 5 });
    // Another tool: not a drag, so the hover is over.
    await render(false, false);
    expect(hover.mock.calls).toHaveLength(1);
    await render(true);
    // Nothing returns until the pointer settles on artwork again, which pulses afresh.
    expect(hover.mock.calls).toHaveLength(1);
    await pointAt({ x: 5.5, y: 5 });
    expect(pulses()).toEqual([true, true]);
  });

  it('pulses again after the pointer really leaves and comes back', async () => {
    await render(true);
    await pointAt({ x: 5, y: 5 });
    await pointAt(null);
    await pointAt({ x: 5, y: 5 });
    expect(pulses()).toEqual([true, true]);
  });

  it('hides the pulse layer while Alt shows every operation colour', async () => {
    await render(true);
    const layer = host.querySelector<HTMLCanvasElement>('[data-testid="artwork-pulse-layer"]');
    expect(layer?.style.visibility).not.toBe('hidden');
    await act(async () => useUiStore.getState().setOperationColorPeek(true));
    expect(layer?.style.visibility).toBe('hidden');
  });

  it.each(['pointerleave', 'pointercancel', 'pointerup'])(
    'ends a paused hover on %s outside the canvas',
    async (eventType) => {
      await render(true);
      await pointAt({ x: 5, y: 5 });
      const clock = hover.mock.contexts[0] as ArtworkPulseClock;
      const highlighted = (): ReadonlyArray<string> =>
        clock.frame(performance.now(), true).pieces.map((piece) => piece.objectId);
      expect(highlighted()).toEqual(['heart']);
      await render(false);
      await act(async () => useStore.getState().setCursorMm(null));
      await render(true);
      expect(highlighted()).toEqual(['heart']);

      // Captured release already cleared cursorMm; leaving cannot change it again.
      await act(async () =>
        canvas.dispatchEvent(new MouseEvent(eventType, { clientX: 900, clientY: 700 })),
      );
      expect(highlighted()).toEqual([]);
      await pointAt({ x: 5, y: 5 });
      expect(pulses()).toEqual([true, false, true]);
    },
  );

  it.each(['pointerleave', 'pointercancel', 'pointerup'])(
    'starts a fresh pulse after %s during a drag and returning to the same piece',
    async (eventType) => {
      await render(true);
      await pointAt({ x: 5, y: 5 });
      await render(false);
      await act(async () => useStore.getState().setCursorMm(null));
      await act(async () =>
        canvas.dispatchEvent(new MouseEvent(eventType, { clientX: 900, clientY: 700 })),
      );
      await render(true);
      expect(pulses()).toEqual([true]);
      await pointAt({ x: 5, y: 5 });
      expect(pulses()).toEqual([true, true]);
    },
  );

  it('cancels the pending dwell when the pointer leaves', async () => {
    await render(true);
    await act(async () => useStore.getState().setCursorMm({ x: 5, y: 5 }));
    await act(async () => canvas.dispatchEvent(new MouseEvent('pointerleave')));
    await act(async () => vi.advanceTimersByTime(PULSE_HOVER_DWELL_MS + 10));
    expect(pulses()).toEqual([]);
  });

  it('regroups when the machine changes while the scene stays identical', async () => {
    const base = project();
    const heart = base.scene.objects[0];
    const engrave = base.scene.layers[0];
    if (heart === undefined || engrave === undefined) throw new Error('missing artwork fixture');
    const scene = {
      ...base.scene,
      layers: [
        { ...engrave, parkedOutput: engrave.output },
        { ...engrave, id: 'sibling', power: engrave.power / 2, parkedOutput: engrave.output },
      ],
      objects: [heart, { ...heart, id: 'other-heart', operationIds: ['sibling'] }],
    };
    useStore.setState({ project: { ...base, scene, machine: DEFAULT_CNC_MACHINE_CONFIG } });
    useUiStore.getState().setHoveredOperationId('engrave');
    await render(true);
    const clock = hover.mock.contexts[0] as ArtworkPulseClock;
    const highlighted = (): ReadonlyArray<string> =>
      clock.frame(performance.now(), true).pieces.map((piece) => piece.objectId);
    expect(highlighted()).toEqual(['heart', 'other-heart']);

    await act(async () => useStore.getState().setMachineKind('laser'));
    expect(useStore.getState().project.scene).toBe(scene);
    await render(true);
    expect(highlighted()).toEqual(['heart']);
    expect(pulses()).toEqual([true, false]);
  });

  it('regroups after Paste settings on the hovered row without another pulse', async () => {
    const base = project();
    const heart = base.scene.objects[0];
    const engrave = base.scene.layers[0];
    if (heart === undefined || engrave === undefined) throw new Error('missing artwork fixture');
    const sibling = { ...engrave, id: 'sibling', color: '#dc2626' };
    const source = { ...engrave, id: 'source', color: '#16a34a', power: engrave.power / 2 };
    useStore.setState({
      project: {
        ...base,
        scene: {
          ...base.scene,
          layers: [engrave, sibling, source],
          objects: [heart, { ...heart, id: 'other-heart', operationIds: ['sibling'] }],
        },
      },
    });
    useStore.getState().copyLayerSettings('source');
    useUiStore.getState().setHoveredOperationId('engrave');
    await render(true);
    const clock = hover.mock.contexts[0] as ArtworkPulseClock;
    const highlighted = (): ReadonlyArray<string> =>
      clock.frame(performance.now(), true).pieces.map((piece) => piece.objectId);
    expect(highlighted()).toEqual(['heart', 'other-heart']);

    // Paste lives inside the row, so its hover identity remains unchanged.
    await act(async () => useStore.getState().pasteLayerSettings('engrave'));
    await render(true);
    expect(useUiStore.getState().hoveredOperationId).toBe('engrave');
    expect(highlighted()).toEqual(['heart']);
    expect(pulses()).toEqual([true, false]);

    // Matching the sibling again restores its edge without restarting a pulse.
    useStore.getState().copyLayerSettings('sibling');
    await act(async () => useStore.getState().pasteLayerSettings('engrave'));
    await render(true);
    expect(highlighted()).toEqual(['heart', 'other-heart']);
    expect(pulses()).toEqual([true, false, false]);
  });
});
