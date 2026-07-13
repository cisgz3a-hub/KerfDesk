import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const media = vi.hoisted(() => ({ compact: false, listener: null as (() => void) | null }));

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
      const hideLayers = [...host.querySelectorAll('button')].find(
        (button) => button.textContent === 'Hide Layers',
      );
      await act(async () => hideLayers?.click());
      expect(host.textContent).not.toContain('Layer rail');
      expect(host.textContent).toContain('Show Layers');
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
