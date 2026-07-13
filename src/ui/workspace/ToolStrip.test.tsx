import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { useStore } from '../state/store';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { ToolStrip } from './ToolStrip';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(node: JSX.Element): Promise<HTMLDivElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(node);
  });
  return host;
}

beforeEach(() => {
  useUiStore.getState().setToolMode({ kind: 'select' });
  useUiStore.getState().setPenDraft(null);
  useStore.setState({
    project: createProject(),
    selectedPathNode: null,
    selectedPathNodes: [],
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('ToolStrip', () => {
  it('uses help topics for drawing tool hover explanations', async () => {
    const h = await render(<ToolStrip />);
    const pen = h.querySelector('button[data-help-id="tool:polyline"]');
    const node = h.querySelector('button[data-help-id="tool:node"]');

    expect(pen?.getAttribute('aria-label')).toBe('Draw polyline');
    expect(pen?.getAttribute('title')).toContain('Enter');
    expect(pen?.getAttribute('title')).toContain('double-click');
    expect(node?.getAttribute('aria-label')).toBe('Edit nodes');
    expect(node?.getAttribute('title')?.toLowerCase()).toContain('nodes');
    expect(h.querySelector('button[data-help-id="tool:measure"]')?.getAttribute('title')).toContain(
      'distance',
    );
  });

  it('toggles an already-active draw tool back to Select mode', async () => {
    useUiStore.getState().setToolMode({ kind: 'draw', shape: 'rect' });
    const h = await render(<ToolStrip />);
    const rect = h.querySelector('button[aria-label="Draw rectangle"]');
    expect(rect?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      rect?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'select' });
    expect(
      h.querySelector('button[aria-label="Select / transform"]')?.getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('arms node edit mode without toggling normal Select transforms', async () => {
    const h = await render(<ToolStrip />);
    const node = h.querySelector('button[aria-label="Edit nodes"]');

    await act(async () => {
      node?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'node' });
    expect(node?.getAttribute('aria-pressed')).toBe('true');
    expect(
      h.querySelector('button[aria-label="Select / transform"]')?.getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('arms the Measure tool from the tool strip', async () => {
    const h = await render(<ToolStrip />);
    const measure = h.querySelector('button[aria-label="Measure"]');

    await act(async () => {
      measure?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'measure' });
    expect(measure?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows curve-node actions and converts the selected segment', async () => {
    const object: ImportedSvg = {
      kind: 'imported-svg',
      id: 'curve',
      source: 'curve.svg',
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
          curves: [
            {
              start: { x: 0, y: 0 },
              segments: [{ kind: 'line', to: { x: 10, y: 0 } }],
              closed: false,
            },
          ],
        },
      ],
    };
    useStore.setState({
      project: {
        ...createProject(),
        scene: {
          objects: [object],
          layers: [createLayer({ id: '#000000', color: '#000000' })],
          groups: [],
        },
      },
      selectedObjectId: 'curve',
      selectedPathNode: {
        objectId: 'curve',
        pathIndex: 0,
        polylineIndex: 0,
        pointIndex: 0,
        geometry: 'curve',
      },
      selectedPathNodes: [
        { objectId: 'curve', pathIndex: 0, polylineIndex: 0, pointIndex: 0, geometry: 'curve' },
      ],
    });
    useUiStore.getState().setToolMode({ kind: 'node' });
    const h = await render(<ToolStrip />);
    const curveButton = h.querySelector('button[aria-label="Curve"]');
    expect(curveButton).not.toBeNull();
    expect(curveButton?.hasAttribute('disabled')).toBe(false);
    await act(async () => curveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    const updated = useStore.getState().project.scene.objects[0] as ImportedSvg;
    expect(updated.paths[0]?.curves?.[0]?.segments[0]?.kind).toBe('cubic');
  });

  it('arms the Star tool from the tool strip', async () => {
    const h = await render(<ToolStrip />);
    const star = h.querySelector('button[aria-label="Draw star"]');

    await act(async () => {
      star?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().toolMode).toEqual({ kind: 'draw', shape: 'star' });
    expect(star?.getAttribute('aria-pressed')).toBe('true');
  });

  it('opens the design library from the tool strip', async () => {
    const h = await render(<ToolStrip />);
    const library = h.querySelector('button[aria-label="Open design library"]');

    await act(async () => {
      library?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().libraryDialogOpen).toBe(true);
  });
});
