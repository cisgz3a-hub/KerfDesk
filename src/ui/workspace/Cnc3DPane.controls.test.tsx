import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRemovalGrid } from '../../core/sim';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useUiStore } from '../state/ui-store';
import { Cnc3DPane } from './Cnc3DPane';
import type * as Cnc3dSceneModule from './use-cnc-3d-scene';

const renderer = vi.hoisted(() => ({
  setDisplayMode: vi.fn(),
  setSectionFraction: vi.fn(),
  capturePng: vi.fn(() => null),
  probeAt: vi.fn(() => null),
}));
const gridResult = createRemovalGrid({
  originX: 0,
  originY: 0,
  widthMm: 10,
  heightMm: 10,
  mmPerCell: 1,
});
if (gridResult.kind !== 'ok') throw new Error(gridResult.reason);
const source = { grid: gridResult.grid, moves: [], toolProfile: [] };
vi.mock('./use-design-scene-source', () => ({ useDesignSceneSource: () => source }));
// Renderer-independent UI audit: real pane, resize, persistence and modal code;
// only WebGL creation is replaced. This does not qualify rendered cut geometry.
vi.mock('./use-cnc-3d-scene', async (original) => ({
  ...(await original<typeof Cnc3dSceneModule>()),
  useCnc3dScene: () => ({ canvasRef: { current: null }, state: 'ready', controls: renderer }),
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('laserforge.cnc-3d-pane-visibility.v1', 'expanded');
  resetStore();
  useStore.getState().setMachineKind('cnc');
  useUiStore.setState({ modalDepth: 0 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  resetStore();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label,
  );
  if (found === undefined) throw new Error(`Missing ${label}`);
  return found;
}

describe('3D pane control outcomes', () => {
  it('Collapse and Expand persist the explicit pane choice without changing the project', async () => {
    const project = useStore.getState().project;
    await act(async () => root.render(<Cnc3DPane />));
    await act(async () => button('Collapse 3D result pane').click());
    expect(host.querySelector('canvas')).toBeNull();
    expect(localStorage.getItem('laserforge.cnc-3d-pane-visibility.v1')).toBe('collapsed');
    await act(async () => button('Expand 3D result pane').click());
    expect(host.querySelector('canvas')).not.toBeNull();
    expect(localStorage.getItem('laserforge.cnc-3d-pane-visibility.v1')).toBe('expanded');
    expect(useStore.getState().project).toBe(project);
  });

  it('Open full page and Close keep the docked scene and release modal ownership', async () => {
    await act(async () => root.render(<Cnc3DPane />));
    const dockedCanvas = host.querySelector('canvas');
    await act(async () => button('Open full page').click());
    expect(document.querySelector('[aria-label="3D result, full page"]')).not.toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(1);
    await act(async () => button('Close').click());
    expect(document.querySelector('[aria-label="3D result, full page"]')).toBeNull();
    expect(host.querySelector('canvas')).toBe(dockedCanvas);
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

  it('the resize handle changes and persists width with keys and a pointer drag', async () => {
    await act(async () => root.render(<Cnc3DPane />));
    const handle = host.querySelector<HTMLElement>('[aria-label="Resize 3D result pane"]');
    const pane = host.querySelector<HTMLElement>('aside');
    if (handle === null || pane === null) throw new Error('Missing pane resize');
    await act(async () =>
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })),
    );
    expect(pane.style.width).toBe('276px');
    expect(localStorage.getItem('laserforge.cnc-3d-pane-width.v1')).toBe('276');
    await act(async () =>
      handle.dispatchEvent(new MouseEvent('pointerdown', { clientX: 500, bubbles: true })),
    );
    await act(async () =>
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 540, bubbles: true })),
    );
    await act(async () => window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })));
    expect(pane.style.width).toBe('236px');
    expect(localStorage.getItem('laserforge.cnc-3d-pane-width.v1')).toBe('236');
  });
});
