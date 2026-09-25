import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type Vec2,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { NodeEditOverlay } from './NodeEditOverlay';
import { useNodeEditStore } from './node-edit-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const VIEW = { zoomFactor: 1, panX: 0, panY: 0 };

let host: HTMLDivElement;
let root: Root;
let base: HTMLCanvasElement;

beforeEach(() => {
  resetStore();
  useUiStore.setState({ toolMode: { kind: 'node' } });
  useNodeEditStore.setState({ pointer: null, selectedSegment: null, feedback: null });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  base = document.createElement('canvas');
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('NodeEditOverlay', () => {
  it('adds its layer only while the node tool edits outside preview', async () => {
    const project = load();
    await render(project, false);
    expect(layer()).not.toBeNull();

    await render(project, true);
    expect(layer()).toBeNull();

    await act(async () => useUiStore.setState({ toolMode: { kind: 'select' } }));
    await render(project, false);
    expect(layer()).toBeNull();
  });

  it('shows a move cursor over a node and a pointer over a segment', async () => {
    const project = load();
    await render(project, false);

    await hoverAt({ x: 0.1, y: 0.1 });
    expect(base.style.cursor).toBe('move');

    await hoverAt({ x: 5, y: 0.1 });
    expect(base.style.cursor).toBe('pointer');
  });
});

async function render(project: Project, previewMode: boolean): Promise<void> {
  await act(async () =>
    root.render(
      <NodeEditOverlay
        baseRef={{ current: base }}
        canvasSize={{ width: 400, height: 300 }}
        project={project}
        previewMode={previewMode}
        viewState={VIEW}
      />,
    ),
  );
}

async function hoverAt(scenePoint: Vec2): Promise<void> {
  await act(async () => useNodeEditStore.getState().setPointer({ scenePoint, pxToMm: 0.1 }));
}

function layer(): Element | null {
  return host.querySelector('[data-testid="node-edit-layer"]');
}

function load(): Project {
  const art: ImportedSvg = {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
  const project: Project = {
    ...createProject(),
    scene: {
      objects: [art],
      layers: [createLayer({ id: '#000000', color: '#000000' })],
      groups: [],
    },
  };
  act(() => useStore.setState({ project, selectedObjectId: 'art' }));
  return project;
}
