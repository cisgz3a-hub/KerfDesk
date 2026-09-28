// The Warp and Deform hint (LBG-T06): what it says, its buttons, and the
// Enter and Esc keys that finish the tool.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene/layer';
import { createProject } from '../../core/scene/project';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene/scene-object';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { useWarpDeformSession } from '../state/warp-deform-session';
import { DEFORM_HINT, WARP_HINT, WarpDeformHint } from './WarpDeformHint';
import { startWarpDeformTool } from './warp-deform-tool';

const PART: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#000000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 40, y: 0 },
            { x: 40, y: 20 },
            { x: 0, y: 20 },
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useToastStore.setState({ toasts: [] });
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: [PART],
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: PART.id,
    additionalSelectedIds: new Set(),
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useUiStore.getState().resetToolMode();
  useWarpDeformSession.getState().setSession(null);
  vi.unstubAllGlobals();
});

async function render(): Promise<void> {
  await act(async () => root.render(<WarpDeformHint />));
}

async function press(key: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function bendOneHandle(): void {
  const session = useWarpDeformSession.getState().session;
  if (session === null) throw new Error('no session');
  useWarpDeformSession
    .getState()
    .setHandles(session.handles.map((h, i) => (i === 5 ? { x: h.x, y: h.y + 5 } : h)));
}

describe('WarpDeformHint', () => {
  it('shows nothing while neither tool is on', async () => {
    await render();
    expect(host.textContent).toBe('');
  });

  it('says to drag the handles, then Enter to apply or Esc to cancel', async () => {
    await act(async () => startWarpDeformTool('warp'));
    await render();
    expect(host.textContent).toContain(WARP_HINT);
    expect(WARP_HINT).toMatch(/Drag the corner handles.*Enter to apply or Esc to cancel/u);

    await act(async () => startWarpDeformTool('deform'));
    expect(host.textContent).toContain(DEFORM_HINT);
    for (const button of host.querySelectorAll('button')) expect(button.title).not.toBe('');
    // Nothing has moved yet, so there is nothing to reset.
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  });

  it('applies on Enter as one undo step', async () => {
    await act(async () => startWarpDeformTool('deform'));
    await render();
    await act(async () => bendOneHandle());

    await press('Enter');

    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(host.textContent).toBe('');
  });

  it('cancels on Esc and keeps the selection', async () => {
    await act(async () => startWarpDeformTool('deform'));
    await render();
    await act(async () => bendOneHandle());
    const project = useStore.getState().project;
    // Stands in for the global Esc, which also clears the selection.
    const globalEsc = vi.fn();
    window.addEventListener('keydown', globalEsc);

    await press('Escape');

    window.removeEventListener('keydown', globalEsc);
    expect(globalEsc).not.toHaveBeenCalled();
    expect(useUiStore.getState().toolMode.kind).toBe('select');
    expect(useStore.getState().project).toBe(project);
    expect(useStore.getState().selectedObjectId).toBe(PART.id);
  });
});
