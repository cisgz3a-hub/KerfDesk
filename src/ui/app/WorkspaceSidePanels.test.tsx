import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { useWorkspaceLayoutStore } from '../state/workspace-layout-store';
import { SINGLE_PANEL_QUERY } from './use-workspace-layout';
import { resetWorkspaceLayout } from './workspace-panel-actions';

const media = vi.hoisted(() => ({
  compact: false,
  narrow: false,
  listeners: new Set<() => void>(),
}));
const COLLAPSED_PANEL_WIDTH_CSS = '48px';

vi.mock('../layers', () => ({ CutsLayersPanel: () => <div>Layer rail</div> }));
vi.mock('../laser', () => ({ LaserWindow: () => <div>Machine rail</div> }));
vi.mock('../laser/WorkspaceJobActions', () => ({
  WorkspaceJobActions: () => (
    <div aria-label="Job actions">
      <button>Frame job</button>
    </div>
  ),
}));

import { WorkspaceSidePanels } from './WorkspaceSidePanels';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderPanels(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(<WorkspaceSidePanels />);
  });
  if (root === null) throw new Error('root missing');
  return { host, root };
}

beforeEach(() => {
  media.compact = false;
  media.narrow = false;
  media.listeners.clear();
  useWorkspaceLayoutStore.setState({ preference: 'auto', resetRevision: 0 });
  useLaserStore.setState({ streamer: null });
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setRailPanelVisible('machine', true);
  useUiStore.setState({ railPanelFocusRequest: null });
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return query === SINGLE_PANEL_QUERY ? media.narrow : media.compact;
    },
    addEventListener: (_event: string, listener: () => void) => {
      media.listeners.add(listener);
    },
    removeEventListener: (_event: string, listener: () => void) => media.listeners.delete(listener),
  }));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('WorkspaceSidePanels', () => {
  it('offers independently collapsible, resizable desktop panels', async () => {
    const { host, root } = await renderPanels();
    try {
      expect(host.textContent).toContain('Layer rail');
      expect(host.textContent).toContain('Machine rail');
      expect(host.querySelectorAll('[aria-label$="resizable panel"]')).toHaveLength(2);
      const layersToggle = [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Layers',
      );
      // Constant label; the shown/hidden state is carried by aria-pressed (the
      // accent-fill toggle) and the title, not by flipping the label text.
      expect(layersToggle?.getAttribute('aria-pressed')).toBe('true');
      await act(async () => layersToggle?.click());
      expect(host.textContent).not.toContain('Layer rail');
      expect(layersToggle?.getAttribute('aria-pressed')).toBe('false');
      expect(layersToggle?.getAttribute('title')).toBe('Show Layers panel');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('shrinks collapsed rail shells instead of leaving blank resizable columns', async () => {
    useUiStore.getState().setRailPanelVisible('layers', false);
    useUiStore.getState().setRailPanelVisible('machine', false);
    const { host, root } = await renderPanels();
    try {
      const layers = requiredPanel(host, 'Cuts / Layers resizable panel');
      const machine = requiredPanel(host, 'Machine controls resizable panel');

      expect(layers.style.width).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(layers.style.minWidth).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(layers.style.resize).toBe('none');
      expect(machine.style.width).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(machine.style.minWidth).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(machine.style.resize).toBe('none');

      await act(async () => useUiStore.getState().setRailPanelVisible('layers', true));
      expect(layers.style.width).toBe('300px');
      expect(layers.style.resize).toBe('horizontal');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps the stored machine-panel preference while a job is active', async () => {
    useUiStore.getState().setRailPanelVisible('machine', false);
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });
    const { host, root } = await renderPanels();
    try {
      const machine = requiredPanel(host, 'Machine controls resizable panel');
      expect(machine.style.width).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(machine.style.minWidth).toBe(COLLAPSED_PANEL_WIDTH_CSS);
      expect(machine.style.resize).toBe('none');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('uses one tabbed rail at the compact breakpoint', async () => {
    media.compact = true;
    const { host, root } = await renderPanels();
    try {
      expect(host.querySelector('[role="tablist"]')).not.toBeNull();
      expect(host.textContent).toContain('Layer rail');
      expect(host.textContent).not.toContain('Machine rail');
      const machine = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Machine',
      );
      await act(async () => machine?.click());
      expect(host.textContent).not.toContain('Layer rail');
      expect(host.textContent).toContain('Machine rail');

      await act(async () => useUiStore.getState().focusRailPanel('layers'));
      expect(host.textContent).toContain('Layer rail');
      expect(host.textContent).not.toContain('Machine rail');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reopens a hidden desktop panel when another surface routes to it', async () => {
    const { host, root } = await renderPanels();
    try {
      const layersToggle = [...host.querySelectorAll('button')].find(
        (button) => button.textContent?.trim() === 'Layers',
      );
      await act(async () => layersToggle?.click());
      expect(host.textContent).not.toContain('Layer rail');

      await act(async () => useUiStore.getState().focusRailPanel('layers'));
      expect(host.textContent).toContain('Layer rail');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps one job dock while switching tabs and opens the selected collapsed rail', async () => {
    media.compact = true;
    useUiStore.getState().setRailPanelVisible('machine', false);
    const { host, root } = await renderPanels();
    try {
      const dock = host.querySelector('[aria-label="Job actions"]');
      const artwork = host.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      artwork?.focus();
      await act(async () =>
        artwork?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
      );
      expect(useUiStore.getState().railPanelVisibility.machine).toBe(true);
      expect(host.querySelectorAll('[aria-label="Job actions"]')).toHaveLength(1);
      expect(host.querySelector('[aria-label="Job actions"]')).toBe(dock);
      expect(document.activeElement?.textContent).toBe('Machine');
      expect(host.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(
        document.activeElement?.id,
      );
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('preserves the manual spacious preference through a temporarily narrow window', async () => {
    media.compact = true;
    media.narrow = true;
    useWorkspaceLayoutStore.getState().setPreference('spacious');
    const { host, root } = await renderPanels();
    try {
      expect(host.querySelector('[data-layout="compact"]')).not.toBeNull();
      await act(async () => {
        media.narrow = false;
        media.listeners.forEach((listener) => listener());
      });
      expect(host.querySelector('[data-layout="spacious"]')).not.toBeNull();
      expect(useWorkspaceLayoutStore.getState().preference).toBe('spacious');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reset layout reopens hidden desktop panels and restores automatic sizing', async () => {
    const { host, root } = await renderPanels();
    try {
      const layers = host.querySelector<HTMLButtonElement>('[title="Hide Layers panel"]');
      await act(async () => layers?.click());
      expect(host.textContent).not.toContain('Layer rail');
      await act(async () => resetWorkspaceLayout(useUiStore.getState()));
      expect(host.textContent).toContain('Layer rail');
      expect(useWorkspaceLayoutStore.getState().preference).toBe('auto');
    } finally {
      await act(async () => root.unmount());
    }
  });
});

function requiredPanel(host: HTMLElement, label: string): HTMLElement {
  const panel = host.querySelector(`[aria-label="${label}"]`);
  if (!(panel instanceof HTMLElement)) throw new Error(`Panel not rendered: ${label}`);
  return panel;
}
