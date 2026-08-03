// The design-time twin of the compiler's rule: V-carve keeps only closed
// contours (core/cnc/vcarve-carvable-contours.ts), so a layer of open strokes
// emits no toolpath at all. These assert the operator is told at the layer,
// before compile, rather than meeting an empty 3D view.

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
import { CncOpenPathNote } from './CncOpenPathNote';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const COLOR = '#000000';
const NOTE_TEXT = 'Every shape on this layer is an open path';

const VCARVE_LAYER: Layer = {
  ...createLayer({ id: 'L1', color: COLOR }),
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve' },
};

// A single-line font stroke: an open centerline, exactly what the operator's
// script lettering produces.
function stroke(closed: boolean): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'A1',
    source: 'A1.svg',
    bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: COLOR,
        polylines: [
          {
            closed,
            points: [
              { x: 10, y: 10 },
              { x: 20, y: 10 },
              { x: 20, y: 20 },
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
      <CncOpenPathNote layer={layer} settings={layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS} />,
    ),
  );
  return { host, root };
}

async function settledText(layer: Layer = VCARVE_LAYER): Promise<string> {
  const view = await renderNote(layer);
  try {
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    return view.host.textContent ?? '';
  } finally {
    await act(async () => view.root.unmount());
    view.host.remove();
  }
}

afterEach(() => {
  vi.useRealTimers();
  resetStore();
});

describe('CncOpenPathNote', () => {
  it('warns when every shape on a V-carve layer is an open path', async () => {
    vi.useFakeTimers();
    install([stroke(false)]);
    expect(await settledText()).toContain(NOTE_TEXT);
  });

  it('stays silent once the layer holds a closed shape to carve', async () => {
    vi.useFakeTimers();
    install([stroke(true)]);
    expect(await settledText()).toBe('');
  });

  it('stays silent on an empty layer, which is its own obvious state', async () => {
    vi.useFakeTimers();
    install([]);
    expect(await settledText()).toBe('');
  });

  // Pocket and Drill emit zero motion from open contours exactly as V-carve
  // does (core/cnc/closed-contour-cut-types.test.ts measures all three against
  // the compiler), so the operator has to be told there too.
  it.each(['pocket', 'drill'] as const)(
    'warns on a %s layer of open paths, which also compiles to nothing',
    async (cutType) => {
      vi.useFakeTimers();
      const layer: Layer = {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
      };
      install([stroke(false)], layer);
      expect(await settledText(layer)).toContain(NOTE_TEXT);
    },
  );

  // The profile and engrave families DO emit from open paths, so warning there
  // would be telling the operator something untrue.
  it.each(['engrave', 'profile-on-path', 'profile-inside'] as const)(
    'stays silent on a %s layer, which cuts open paths fine',
    async (cutType) => {
      vi.useFakeTimers();
      const layer: Layer = {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
      };
      install([stroke(false)], layer);
      expect(await settledText(layer)).toBe('');
    },
  );
});
