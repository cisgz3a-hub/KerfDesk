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
      h
        .querySelector('button[aria-label="Select / transform (Esc)"]')
        ?.getAttribute('aria-pressed'),
    ).toBe('true');
  });
});
