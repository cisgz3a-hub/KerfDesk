// ADR-272 Amendment 9: the Studio's session code is its own lazy chunk. A
// window left on the previous build cannot fetch it, so the first Open must
// show the Studio's load-failure notice — not crash, not silently do nothing —
// and Close must dismiss it, while a later Open asks again.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Vitest wraps a throwing mock factory in its own error, so the dynamic import
// rejects the way a failed chunk fetch does in the browser.
vi.mock('./design-studio-runtime', () => {
  throw new TypeError('Failed to fetch dynamically imported module: design-studio-runtime-0ld.js');
});

import { useUiStore } from '../state/ui-store';
import { DesignStudioHost } from './DesignStudioHost';
import { openDesignStudio } from './design-studio-open';
import { designStudioRuntime, useDesignStudioShell } from './design-studio-shell';

let root: Root | null = null;

beforeEach(() => {
  // React logs every error a boundary catches.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function closeButton(): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(
    'button[title="Close this tool and return to your work"]',
  );
  if (match === null) throw new Error('The load-failure notice has no Close button');
  return match;
}

it('shows the Studio notice when its session code cannot be fetched, and Close dismisses it', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<DesignStudioHost />);
  });

  await act(async () => openDesignStudio());

  expect(designStudioRuntime()).toBeNull();
  expect(useDesignStudioShell.getState()).toMatchObject({ loading: false, sessionOpen: false });
  expect(document.body.textContent).toContain('Design Studio could not load');

  await act(async () => closeButton().click());
  expect(useDesignStudioShell.getState().loadFailure).toBeNull();
  expect(document.body.textContent).not.toContain('could not load');
  expect(useUiStore.getState().modalDepth).toBe(0);

  // A later Open asks again rather than replaying a cached failure silently.
  await act(async () => openDesignStudio());
  expect(document.body.textContent).toContain('Design Studio could not load');
});
