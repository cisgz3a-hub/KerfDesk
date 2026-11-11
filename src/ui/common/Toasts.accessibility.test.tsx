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
    const toast = region?.querySelector<HTMLElement>('.lf-toast');
    const message = toast?.querySelector('.lf-toast__message');
    const dismiss = toast?.querySelector('button');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(message?.textContent).toBe('Warning: Check the fixture');
    expect(dismiss?.getAttribute('aria-label')).toContain('warning notification');
    // Sharing the canvas's space, the body must not swallow a click or drag
    // meant for the drawing; Toasts.css makes .lf-toast pointer-events: none
    // and only the dismiss control a pointer target.
    expect(dismiss?.className).toBe('lf-toast__dismiss');

    await act(async () => root.unmount());
  });
});

// The region is aria-live="polite" with aria-relevant="additions": a screen
// reader speaks element nodes ADDED inside it and ignores text edited in
// place. So what is spoken is what is added, and that is what these count
// (ADR-708; a live region must not be flooded, ADR-207 and UX audit U7-P2-1).
describe('Toasts live region and keyed rewrites', () => {
  async function mount(): Promise<{
    readonly region: Element;
    readonly added: () => ReadonlyArray<string>;
    readonly unmount: () => Promise<void>;
  }> {
    vi.useFakeTimers();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => root.render(<Toasts />));
    const region = host.querySelector('[role="region"][aria-label="Notifications"]');
    if (region === null) throw new Error('no notification region');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => void records.push(...batch));
    observer.observe(region, { childList: true, subtree: true });
    return {
      region,
      // The text of each element added since the last call.
      added: () =>
        [...records.splice(0), ...observer.takeRecords()]
          .flatMap((record) => [...record.addedNodes])
          .filter((node): node is Element => node instanceof Element)
          .map((element) => element.textContent ?? ''),
      unmount: async () => {
        observer.disconnect();
        await act(async () => root.unmount());
      },
    };
  }

  const push = async (
    message: string,
    variant: 'info' | 'warning' | 'error',
    key: string,
  ): Promise<void> => {
    await act(async () => useToastStore.getState().pushToast(message, variant, { key }));
  };

  it('keeps additions-only announcements', async () => {
    const { region, unmount } = await mount();
    expect(region.getAttribute('aria-relevant')).toBe('additions');
    expect(region.getAttribute('aria-atomic')).toBe('false');
    await unmount();
  });

  it('says a repeated jog warning once: ten identical rewrites add nothing', async () => {
    const { added, unmount } = await mount();
    await push('Jog target is outside the configured machine bounds.', 'warning', 'jog');
    expect(added().join('|')).toContain(
      'Warning: Jog target is outside the configured machine bounds.',
    );
    for (let click = 0; click < 9; click += 1) {
      await push('Jog target is outside the configured machine bounds.', 'warning', 'jog');
    }
    expect(added()).toEqual([]);
    await unmount();
  });

  it('says a warning rewritten with new text, once, with its severity', async () => {
    const { region, added, unmount } = await mount();
    await push('Jog target is outside the configured machine bounds.', 'warning', 'jog');
    added();
    await push('This jog path crosses the configured no-go zone "Clamp".', 'warning', 'jog');
    expect(added()).toEqual(['Warning: This jog path crosses the configured no-go zone "Clamp".']);
    // Still one toast: the slot was rewritten, not stacked.
    expect(region.querySelectorAll('.lf-toast')).toHaveLength(1);
    expect(region.textContent).not.toContain('outside the configured machine bounds');
    await unmount();
  });

  it('says a slot that turns from progress into an error', async () => {
    const { added, unmount } = await mount();
    await push('Importing logo.svg…', 'info', 'import');
    added();
    await push('Could not import logo.svg', 'error', 'import');
    expect(added()).toEqual(['Error: Could not import logo.svg']);
    await unmount();
  });

  it('keeps a progress line quiet: its text changes in place', async () => {
    const { region, added, unmount } = await mount();
    await push('Importing logo.svg… 10%', 'info', 'import');
    added();
    for (const percent of [20, 40, 60, 80, 100]) {
      await push(`Importing logo.svg… ${percent}%`, 'info', 'import');
    }
    expect(added()).toEqual([]);
    expect(region.textContent).toContain('Importing logo.svg… 100%');
    await unmount();
  });
});
