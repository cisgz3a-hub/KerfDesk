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
import { CncVCarveOpenPathNote } from './CncVCarveOpenPathNote';

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
      <CncVCarveOpenPathNote layer={layer} settings={layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS} />,
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

describe('CncVCarveOpenPathNote', () => {
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

  it('stays silent for non-v-carve cut types, which cut open paths fine', async () => {
    vi.useFakeTimers();
    const engraveLayer: Layer = {
      ...createLayer({ id: 'L1', color: COLOR }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'engrave' },
    };
    install([stroke(false)], engraveLayer);
    expect(await settledText(engraveLayer)).toBe('');
  });
});
