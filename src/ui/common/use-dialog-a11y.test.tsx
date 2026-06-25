import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogA11y } from './use-dialog-a11y';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// A fresh onClose arrow each render — exactly what a parent that re-renders
// passes (e.g. LaserWindow's 250 ms status poll re-rendering DeviceSetupControls,
// which mounts the wizard with onClose={() => setOpen(false)}).
function FocusHarness({ tick }: { readonly tick: number }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, () => undefined);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1} data-tick={tick}>
      <input aria-label="first" />
      <input aria-label="second" />
    </div>
  );
}

function OnCloseHarness({ onClose }: { readonly onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" tabIndex={-1}>
      <input aria-label="only" />
    </div>
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('useDialogA11y', () => {
  it('keeps focus where the user put it when the parent re-renders with a new onClose', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<FocusHarness tick={0} />);
      });
      const first = host.querySelector<HTMLInputElement>('input[aria-label="first"]');
      const second = host.querySelector<HTMLInputElement>('input[aria-label="second"]');
      if (first === null || second === null) throw new Error('inputs missing');

      // Initial focus lands on the first focusable element.
      expect(document.activeElement).toBe(first);

      // The operator moves to the second field (e.g. opens the air-assist select).
      await act(async () => second.focus());
      expect(document.activeElement).toBe(second);

      // A parent re-render passes a new onClose identity. Focus must NOT snap
      // back to the first field.
      await act(async () => root?.render(<FocusHarness tick={1} />));
      expect(document.activeElement).toBe(second);
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });

  it('invokes the latest onClose on Escape after a re-render', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let root: Root | null = null;
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    try {
      await act(async () => {
        root = createRoot(host);
        root.render(<OnCloseHarness onClose={firstClose} />);
      });
      await act(async () => root?.render(<OnCloseHarness onClose={latestClose} />));
      const node = host.querySelector('[role="dialog"]');
      await act(async () => {
        node?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      expect(latestClose).toHaveBeenCalledTimes(1);
      expect(firstClose).not.toHaveBeenCalled();
    } finally {
      if (root !== null) await act(async () => root?.unmount());
      host.remove();
    }
  });
});
