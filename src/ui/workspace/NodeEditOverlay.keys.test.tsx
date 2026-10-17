import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { NodeEditOverlay } from './NodeEditOverlay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;

const LINE: ImportedSvg = {
  kind: 'imported-svg',
  id: 'line',
  source: 'line.svg',
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
  transform: IDENTITY_TRANSFORM,
  operationIds: ['cut'],
  paths: [
    {
      color: '#000000',
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: [{ kind: 'line', to: { x: 100, y: 0 } }],
          closed: false,
        },
      ],
      polylines: [{ points: [], closed: false }],
    },
  ],
};

const segmentCount = (): number | undefined => {
  const object = useStore.getState().project.scene.objects[0];
  return object !== undefined && 'paths' in object
    ? object.paths[0]?.curves?.[0]?.segments.length
    : undefined;
};

function pressM(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(async () => {
  resetStore();
  useUiStore.getState().setToolMode({ kind: 'node' });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        objects: [LINE],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    cursorMm: { x: 50, y: 0 },
  }));
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <NodeEditOverlay
        project={useStore.getState().project}
        canvasSize={{ width: 1000, height: 1000 }}
        viewState={{ zoomFactor: 1, panX: 0, panY: 0 }}
        enabled
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  while (useUiStore.getState().modalDepth > 0) useUiStore.getState().unregisterModal();
});

describe('node tool hover keys and the keyboard owner', () => {
  it('edits the hovered segment when nothing else owns the keyboard', () => {
    const event = pressM();
    expect(event.defaultPrevented).toBe(true);
    expect(segmentCount()).toBe(2);
  });

  it('leaves the key alone while a dialog is open', () => {
    useUiStore.getState().registerModal();
    const event = pressM();
    expect(event.defaultPrevented).toBe(false);
    expect(segmentCount()).toBe(1);
  });
});
