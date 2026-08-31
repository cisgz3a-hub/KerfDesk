import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDialogA11y } from './use-dialog-a11y';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function SurfaceDialog(props: { readonly onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useDialogA11y(ref, props.onClose, { closeOnEscape: false, initialFocus: 'surface' });
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Studio" tabIndex={-1}>
      <button type="button">Studio action</button>
    </div>
  );
}

function NestedDialogs(props: {
  readonly onOuterClose: () => void;
  readonly onInnerClose: () => void;
}): JSX.Element {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useDialogA11y(outerRef, props.onOuterClose);
  useDialogA11y(innerRef, props.onInnerClose);
  return (
    <div ref={outerRef} role="dialog" aria-modal="true" aria-label="Outer" tabIndex={-1}>
      <button type="button">Outer action</button>
      <div ref={innerRef} role="dialog" aria-modal="true" aria-label="Inner" tabIndex={-1}>
        <button type="button">Inner action</button>
      </div>
    </div>
  );
}

afterEach(() => document.body.replaceChildren());

describe('useDialogA11y topmost ownership', () => {
  it('focuses a Studio surface, leaves its Escape ladder in charge, and restores its opener', async () => {
    const opener = document.createElement('button');
    const host = document.createElement('div');
    document.body.append(opener, host);
    opener.focus();
    const onClose = vi.fn();
    const root = createRoot(host);

    await act(async () => root.render(<SurfaceDialog onClose={onClose} />));
    const studio = host.querySelector<HTMLElement>('[aria-label="Studio"]');
    const action = host.querySelector<HTMLButtonElement>('button');
    expect(document.activeElement).toBe(studio);
    if (studio === null || action === null) throw new Error('Studio focus fixtures missing');
    Object.defineProperty(action, 'offsetParent', { configurable: true, value: studio });
    await pressKey(studio, 'Tab');
    expect(document.activeElement).toBe(action);
    await pressKey(studio, 'Escape');
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    expect(document.activeElement).toBe(opener);
  });

  it('lets only the last nested modal handle Escape', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    const root: Root = createRoot(host);
    await act(async () => root.render(<NestedDialogs {...{ onOuterClose, onInnerClose }} />));

    const inner = host.querySelector<HTMLElement>('[aria-label="Inner"]');
    await pressKey(inner, 'Escape');
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });
});

async function pressKey(target: HTMLElement | null, key: string): Promise<void> {
  if (target === null) throw new Error('key target missing');
  await act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
}
