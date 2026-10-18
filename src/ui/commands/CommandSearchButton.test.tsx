import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandSearchButton } from './CommandSearchButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function renderButton(): HTMLButtonElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host);
    root.render(<CommandSearchButton />);
  });
  const button = host.querySelector('button');
  if (button === null) throw new Error('no button');
  return button;
}

describe('CommandSearchButton shortcut (ADR-607)', () => {
  it('shows Ctrl+K on Windows and Linux', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
    const button = renderButton();
    expect(button.querySelector('kbd')?.textContent).toBe('Ctrl+K');
    expect(button.title).toContain('(Ctrl+K)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K');
  });

  it('shows ⌘K on a Mac, where Command opens the search', () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    const button = renderButton();
    expect(button.querySelector('kbd')?.textContent).toBe('⌘K');
    expect(button.title).toContain('(⌘K)');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+K');
  });
});
