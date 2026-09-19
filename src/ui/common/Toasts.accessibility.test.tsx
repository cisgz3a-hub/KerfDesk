import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../state/toast-store';
import { Toasts } from './Toasts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  vi.useRealTimers();
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  document.body.replaceChildren();
});

describe('Toasts accessibility', () => {
  it('names the notification region and exposes severity without relying on color', async () => {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Toasts />));
    await act(async () => useToastStore.getState().pushToast('Check the fixture', 'warning'));

    const region = host.querySelector('[role="region"][aria-label="Notifications"]');
    const toast = region?.querySelector<HTMLElement>(':scope > div');
    const message = toast?.querySelector('span');
    const dismiss = toast?.querySelector('button');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(message?.textContent).toBe('Warning: Check the fixture');
    expect(dismiss?.getAttribute('aria-label')).toContain('warning notification');
    // Overlaid on the canvas, the body must not swallow a click or drag meant
    // for the drawing; only the dismiss control takes pointer input.
    expect(toast?.style.pointerEvents).toBe('none');
    expect(dismiss?.style.pointerEvents).toBe('auto');

    await act(async () => root.unmount());
  });
});
