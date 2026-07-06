import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
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
