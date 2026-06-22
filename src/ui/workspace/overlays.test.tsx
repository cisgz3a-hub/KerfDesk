import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SNAP_SETTINGS } from './snapping';
import { useUiStore } from '../state/ui-store';
import { ZoomControls } from './overlays';

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
  useUiStore.getState().setSnapSettings(DEFAULT_SNAP_SETTINGS);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
});

describe('ZoomControls snap toggle', () => {
  it('toggles workspace snapping from the canvas overlay', async () => {
    const h = await render(<ZoomControls />);
    const snap = h.querySelector('button[aria-label="Toggle snapping"]');

    expect(snap?.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      snap?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(useUiStore.getState().snapSettings.enabled).toBe(false);
    expect(snap?.getAttribute('aria-pressed')).toBe('false');
  });
});
