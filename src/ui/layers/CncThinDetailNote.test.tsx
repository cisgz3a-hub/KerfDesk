import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  type Layer,
  type SceneObject,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { CncThinDetailNote } from './CncThinDetailNote';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#000000';

const VCARVE_LAYER: Layer = {
  ...createLayer({ id: 'L1', color: COLOR }),
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
};

function artwork(strokeWidthMm: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'A1',
    source: 'A1.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 10 + strokeWidthMm },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 10 + strokeWidthMm },
              { x: 10, y: 10 + strokeWidthMm },
            ],
          },
        ],
      },
    ],
  };
}

function install(objects: ReadonlyArray<SceneObject>, layer: Layer = VCARVE_LAYER): void {
  useStore.setState({
    project: { ...createProject(), scene: { objects: [...objects], layers: [layer] } },
  });
  useStore.getState().setMachineKind('cnc');
}

async function renderNote(
  layer: Layer = VCARVE_LAYER,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <CncThinDetailNote layer={layer} settings={layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS} />,
    ),
  );
  return { host, root };
}

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

describe('CncThinDetailNote', () => {
  it('notes hairline artwork once the scene settles (300 ms debounce)', async () => {
    vi.useFakeTimers();
    install([artwork(0.06)]);
    const view = await renderNote();
    try {
      expect(view.host.textContent).toBe('');
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(view.host.textContent).toContain('finer than 0.1 mm');
      expect(view.host.querySelector('[role="note"]')).not.toBeNull();
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('stays silent for artwork the detail pass can carve', async () => {
    vi.useFakeTimers();
    install([artwork(0.5)]);
    const view = await renderNote();
    try {
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(view.host.textContent).toBe('');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });

  it('stays silent for non-v-carve cut types without compiling anything', async () => {
    vi.useFakeTimers();
    const profileLayer: Layer = {
      ...createLayer({ id: 'L1', color: COLOR }),
      cnc: DEFAULT_CNC_LAYER_SETTINGS,
    };
    install([artwork(0.06)], profileLayer);
    const view = await renderNote(profileLayer);
    try {
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      expect(view.host.textContent).toBe('');
    } finally {
      await act(async () => view.root.unmount());
      view.host.remove();
    }
  });
});
