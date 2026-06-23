import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM } from '../../core/scene';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import { StatusBar } from './StatusBar';

const EM_DASH = String.fromCharCode(0x2014);
const MIDDLE_DOT = String.fromCharCode(0x00b7);
const TIMES = String.fromCharCode(0x00d7);
const MOJIBAKE_MARKERS = /[\u00e2\u00c3\u00c2]/u;

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  useStore.getState().newProject();
  useUiStore.getState().resetView();
});

describe('StatusBar', () => {
  it('renders clean status text for empty workspace and bed size', async () => {
    const { host, root } = await renderStatusBar();
    try {
      expect(host.textContent).toContain(`Cursor: ${EM_DASH}`);
      expect(host.textContent).toContain(`Bed: 400 ${TIMES} 400 mm`);
      expect(host.textContent).not.toMatch(MOJIBAKE_MARKERS);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('renders selected-object dimensions without corrupted separators', async () => {
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          layers: [],
          objects: [
            {
              kind: 'imported-svg',
              id: 'shape-1',
              source: 'shape.svg',
              bounds: { minX: 0, minY: 0, maxX: 25, maxY: 10 },
              transform: { ...IDENTITY_TRANSFORM, x: 5, y: 6 },
              paths: [],
            },
          ],
        },
      },
      selectedObjectId: 'shape-1',
      additionalSelectedIds: new Set(),
    });

    const { host, root } = await renderStatusBar();
    try {
      expect(host.textContent).toContain(
        `1 selected ${MIDDLE_DOT} 25.0 ${TIMES} 10.0 mm ${MIDDLE_DOT} X 5.0, Y 6.0`,
      );
      expect(host.textContent).not.toMatch(MOJIBAKE_MARKERS);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('summarizes grouped and locked artwork for Lane 9 workspace workflows', async () => {
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          layers: [],
          groups: [{ id: 'group-1', name: 'Group 1', objectIds: ['shape-1', 'shape-2'] }],
          objects: [
            sceneObject('shape-1'),
            sceneObject('shape-2', true),
            sceneObject('shape-3', true),
          ],
        },
      },
    });

    const { host, root } = await renderStatusBar();
    try {
      expect(host.textContent).toContain('Groups: 1');
      expect(host.textContent).toContain('Locked: 2');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('warns when selected Fill-layer vector geometry has open contours', async () => {
    const fillLayer = createLayer({ id: '#000000', color: '#000000', mode: 'fill' });
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          layers: [fillLayer],
          objects: [
            {
              kind: 'imported-svg',
              id: 'open-fill',
              source: 'open-fill.svg',
              bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
              transform: IDENTITY_TRANSFORM,
              paths: [
                {
                  color: '#000000',
                  polylines: [
                    {
                      closed: false,
                      points: [
                        { x: 0, y: 0 },
                        { x: 10, y: 0 },
                        { x: 10, y: 10 },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
      selectedObjectId: 'open-fill',
      additionalSelectedIds: new Set(),
    });

    const { host, root } = await renderStatusBar();
    try {
      expect(host.textContent).toContain('Fill warning: 1 open contour will not fill');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function sceneObject(
  id: string,
  locked = false,
): ReturnType<typeof useStore.getState>['project']['scene']['objects'][number] {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    ...(locked ? { locked: true } : {}),
  };
}

async function renderStatusBar(): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<StatusBar />);
  });
  if (root === null) throw new Error('root did not mount');
  return { host, root };
}
