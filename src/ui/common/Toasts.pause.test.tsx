// The countdown stops while the operator points at a toast or has focus in it
// (annoyance audit A5-P2-5, ADR-708), without the toast body ever taking
// pointer input: the pointer is watched on the document.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../state/toast-store';
import { Toasts } from './Toasts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<Toasts />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function push(message: string, variant: 'warning' | 'success' = 'warning'): Promise<void> {
  await act(async () => useToastStore.getState().pushToast(message, variant));
}

/** Gives the toast showing `message` a box on screen; jsdom lays nothing out. */
function placeToast(message: string, top: number): HTMLElement {
  const toast = [...host.querySelectorAll<HTMLElement>('.lf-toast')].find((element) =>
    element.textContent?.includes(message),
  );
  if (toast === undefined) throw new Error(`no toast shows "${message}"`);
  const box = {
    left: 12,
    right: 372,
    top,
    bottom: top + 40,
    width: 360,
    height: 40,
    x: 12,
    y: top,
  };
  toast.getBoundingClientRect = () => ({ ...box, toJSON: () => box });
  return toast;
}

async function movePointer(x: number, y: number, buttons = 0): Promise<void> {
  await act(async () => {
    document.dispatchEvent(
      new MouseEvent('pointermove', { clientX: x, clientY: y, buttons, bubbles: true }),
    );
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

const shown = (): number => host.querySelectorAll('.lf-toast').length;

describe('Toasts pause', () => {
  it('stops the countdown while the pointer is over the toast, and goes on when it leaves', async () => {
    await push('Check the fixture');
    placeToast('Check the fixture', 500);
    await advance(3000);

    await movePointer(100, 520);
    await advance(60_000);
    expect(shown()).toBe(1);

    await movePointer(100, 100);
    await advance(4999);
    expect(shown()).toBe(1);
    await advance(1);
    expect(shown()).toBe(0);
  });

  it('pauses only the toast under the pointer', async () => {
    await push('First');
    await push('Second');
    placeToast('First', 500);
    placeToast('Second', 548);

    await movePointer(100, 560);
    await advance(8000);
    expect(host.textContent).not.toContain('First');
    expect(host.textContent).toContain('Second');
  });

  it('does not pause for a drag that crosses the toast', async () => {
    await push('Check the fixture');
    placeToast('Check the fixture', 500);
    await movePointer(100, 520, 1);
    await advance(8000);
    expect(shown()).toBe(0);
  });

  it('goes on when the pointer leaves the window', async () => {
    await push('Check the fixture');
    placeToast('Check the fixture', 500);
    await movePointer(100, 520);
    await act(async () => {
      document.documentElement.dispatchEvent(new MouseEvent('pointerleave'));
    });
    await advance(8000);
    expect(shown()).toBe(0);
  });

  it('pauses the next toast that slides under a still pointer', async () => {
    await push('Leaves first', 'success');
    await push('Slides up');
    placeToast('Leaves first', 500);
    const second = placeToast('Slides up', 548);
    await movePointer(100, 520);
    // The first toast is dismissed; the second now sits under the pointer.
    second.getBoundingClientRect = () => {
      const box = {
        left: 12,
        right: 372,
        top: 500,
        bottom: 540,
        width: 360,
        height: 40,
        x: 12,
        y: 500,
      };
      return { ...box, toJSON: () => box };
    };
    const [first] = useToastStore.getState().toasts;
    await act(async () => useToastStore.getState().dismissToast(first?.id ?? ''));
    await advance(60_000);
    expect(host.textContent).toContain('Slides up');
  });

  it('stops the countdown while keyboard focus is inside the toast', async () => {
    await push('Check the fixture');
    const dismiss = host.querySelector<HTMLButtonElement>('.lf-toast__dismiss');
    await advance(3000);

    await act(async () => dismiss?.focus());
    await advance(60_000);
    expect(shown()).toBe(1);

    await act(async () => dismiss?.blur());
    await advance(4999);
    expect(shown()).toBe(1);
    await advance(1);
    expect(shown()).toBe(0);
  });

  it('never makes the toast body a pointer target', async () => {
    await push('Check the fixture');
    const toast = placeToast('Check the fixture', 500);
    const seen: boolean[] = [];
    const onDown = (event: Event): void => void seen.push(event.defaultPrevented);
    document.addEventListener('pointerdown', onDown);
    await act(async () => {
      toast.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    });
    document.removeEventListener('pointerdown', onDown);
    // The press bubbles on untouched: the pause watches, it never handles.
    expect(seen).toEqual([false]);
  });
});
