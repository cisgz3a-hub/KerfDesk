import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { REDUCED_MOTION_QUERY, usePrefersReducedMotion } from './use-prefers-reduced-motion';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function MotionHarness(): JSX.Element {
  const prefersReducedMotion = usePrefersReducedMotion();
  return <div data-reduced-motion={String(prefersReducedMotion)} />;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('usePrefersReducedMotion', () => {
  it('tracks the media query and a live preference change', async () => {
    const listeners: Array<(event: { readonly matches: boolean }) => void> = [];
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      matches: true,
      addEventListener: (_type: string, listener: (event: { readonly matches: boolean }) => void) =>
        listeners.push(listener),
      removeEventListener,
    }));
    vi.stubGlobal('matchMedia', matchMedia);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);

    await act(async () => root.render(<MotionHarness />));
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(host.firstElementChild?.getAttribute('data-reduced-motion')).toBe('true');
    await act(async () => listeners[0]?.({ matches: false }));
    expect(host.firstElementChild?.getAttribute('data-reduced-motion')).toBe('false');

    await act(async () => root.unmount());
    expect(removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });
});
