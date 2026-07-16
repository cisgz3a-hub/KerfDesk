import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';

const media = vi.hoisted(() => ({ compact: false, listener: null as (() => void) | null }));
const COLLAPSED_PANEL_WIDTH_CSS = '48px';

vi.mock('../layers', () => ({ CutsLayersPanel: () => <div>Layer rail</div> }));
vi.mock('../laser', () => ({ LaserWindow: () => <div>Machine rail</div> }));

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
  media.listener = null;
  useLaserStore.setState({ streamer: null });
  useUiStore.getState().setRailPanelVisible('layers', true);
  useUiStore.getState().setRailPanelVisible('machine', true);
  vi.stubGlobal('matchMedia', () => ({
    matches: media.compact,
    addEventListener: (_event: string, listener: () => void) => {
      media.listener = listener;
    },
    removeEventListener: vi.fn(),
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

  it('keeps the machine shell expanded while an active job overrides its collapsed preference', async () => {
    useUiStore.getState().setRailPanelVisible('machine', false);
    useLaserStore.setState({ streamer: step(createStreamer('G1 X1 S100')).state });
    const { host, root } = await renderPanels();
    try {
      const machine = requiredPanel(host, 'Machine controls resizable panel');
      expect(machine.style.width).toBe('300px');
      expect(machine.style.resize).toBe('horizontal');
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
