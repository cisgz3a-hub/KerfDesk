import { act, StrictMode, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dialog } from '../kit/Dialog';
import { useUiStore } from '../state/ui-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  useUiStore.setState({ modalDepth: 0 });
});

function opener(label = 'Open settings'): HTMLButtonElement {
  const button = document.createElement('button');
  button.textContent = label;
  document.body.append(button);
  button.focus();
  return button;
}

function view(strict = false) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  return {
    host,
    render: async (node: ReactNode) => {
      await act(async () => root.render(strict ? <StrictMode>{node}</StrictMode> : node));
    },
  };
}

function autofocusDialog(label = 'Settings', onClose = () => undefined) {
  return (
    <Dialog ariaLabel={label} onClose={onClose}>
      <input aria-label="Draft" autoFocus />
      <button type="button">Cancel</button>
    </Dialog>
  );
}

describe('dialog opener ownership before descendant autofocus', () => {
  it.each([false, true])(
    'returns to the existing opener after close (StrictMode=%s)',
    async (strict) => {
      const target = opener();
      const modal = view(strict);
      await modal.render(autofocusDialog());
      expect(document.activeElement).toBe(modal.host.querySelector('input'));
      expect(useUiStore.getState().modalDepth).toBe(1);
      await modal.render(null);
      expect(target.isConnected).toBe(true);
      expect(document.activeElement).toBe(target);
      expect(useUiStore.getState().modalDepth).toBe(0);
    },
  );

  it('keeps the original opener and latest Escape callback through a StrictMode rerender', async () => {
    const target = opener();
    const modal = view(true);
    const originalClose = vi.fn();
    const latestClose = vi.fn();
    await modal.render(autofocusDialog('Settings', originalClose));
    const cancel = modal.host.querySelector('button')!;
    cancel.focus();
    await modal.render(autofocusDialog('Settings', latestClose));
    expect(document.activeElement).toBe(cancel);
    await act(async () =>
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
    );
    expect(latestClose).toHaveBeenCalledExactlyOnceWith();
    expect(originalClose).not.toHaveBeenCalled();
    await modal.render(null);
    expect(document.activeElement).toBe(target);
  });

  it('restores a nested autofocus dialog to its parent control before the parent closes', async () => {
    const target = opener();
    const modal = view(true);
    const parent = (nested: boolean) => (
      <Dialog ariaLabel="Parent settings" onClose={() => undefined}>
        <button type="button">Open nested settings</button>
        {nested ? autofocusDialog('Nested settings') : null}
      </Dialog>
    );
    await modal.render(parent(false));
    const nestedOpener = modal.host.querySelector('button')!;
    nestedOpener.focus();
    await modal.render(parent(true));
    expect(document.activeElement).toBe(modal.host.querySelector('input'));
    expect(useUiStore.getState().modalDepth).toBe(2);
    await modal.render(parent(false));
    expect(document.activeElement).toBe(nestedOpener);
    await modal.render(null);
    expect(document.activeElement).toBe(target);
    expect(useUiStore.getState().modalDepth).toBe(0);
  });

  it('closing a lower modal leaves the still-open upper modal in charge of focus', async () => {
    const target = opener();
    const modal = view(true);
    const layers = (lower: boolean, upper: boolean) => (
      <>
        {lower ? (
          <Dialog key="lower" ariaLabel="Lower" onClose={() => undefined}>
            <button type="button">Open upper</button>
          </Dialog>
        ) : null}
        {upper ? (
          <Dialog key="upper" ariaLabel="Upper" onClose={() => undefined}>
            <input aria-label="Upper draft" autoFocus />
          </Dialog>
        ) : null}
      </>
    );
    await modal.render(layers(true, false));
    await modal.render(layers(true, true));
    const upper = modal.host.querySelector('input')!;
    expect(document.activeElement).toBe(upper);
    await modal.render(layers(false, true));
    expect(document.activeElement).toBe(upper);
    expect(target.isConnected).toBe(true);
  });

  it('does not undo a deliberate focus move outside the closing dialog', async () => {
    const target = opener();
    const other = opener('Another control');
    target.focus();
    const modal = view(true);
    await modal.render(autofocusDialog());
    other.focus();
    await modal.render(null);
    expect(document.activeElement).toBe(other);
  });

  it('uses the overflow trigger when the autofocus dialog original opener is removed', async () => {
    const fallback = opener('More commands');
    fallback.id = 'dialog-opener-overflow';
    const target = opener('Convert to Bitmap');
    target.dataset['dialogFocusFallback'] = fallback.id;
    const modal = view(true);
    await modal.render(autofocusDialog());
    target.remove();
    await modal.render(null);
    expect(document.activeElement).toBe(fallback);
  });
});
