import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  createLayer,
  createProject,
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
let root: Root;
let hover: MockInstance<ArtworkPulseClock['hover']>;

async function render(canvasHoverEnabled: boolean): Promise<void> {
  await act(async () =>
    root.render(
      <ArtworkPulseOverlay
        project={useStore.getState().project}
        canvasSize={SIZE}
        viewState={VIEW}
        canvasHoverEnabled={canvasHoverEnabled}
      />,
    ),
  );
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
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
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
    await render(true);
    expect(pulses()).toEqual([true, false]);

    // The next small move on the same piece is still the same hover.
    await pointAt({ x: 5.5, y: 5 });
    expect(pulses()).toEqual([true, false]);
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
});
