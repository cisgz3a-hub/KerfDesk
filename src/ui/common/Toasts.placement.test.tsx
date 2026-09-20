import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../state/toast-store';
import { Toasts } from './Toasts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerHeight', 720);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function renderToasts(): void {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Toasts />));
  act(() => useToastStore.getState().pushToast('Frame complete', 'success'));
}

function modal(): { backdrop: HTMLElement; panel: HTMLElement } {
  const backdrop = document.createElement('div');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  const panel = document.createElement('form');
  panel.className = 'lf-dialog';
  panel.innerHTML = '<h2>Machine setup</h2><button type="submit">Save</button>';
  backdrop.append(panel);
  document.body.append(backdrop);
  return { backdrop, panel };
}

async function flushPlacement(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(32);
  });
}

describe('Toast placement', () => {
  it('follows available canvas geometry when the workspace shrinks above live controls', async () => {
    const workspace = document.createElement('div');
    workspace.setAttribute('data-toast-workspace', '');
    document.body.append(workspace);
    const measure = vi.spyOn(workspace, 'getBoundingClientRect');
    measure.mockReturnValue(new DOMRect(50, 120, 830, 520));
    renderToasts();
    const notifications = document.querySelector<HTMLElement>('[aria-label="Notifications"]');
    expect(notifications?.style.left).toBe('62px');
    expect(notifications?.style.bottom).toBe('136px');
    expect(notifications?.style.width).toBe('360px');

    measure.mockReturnValue(new DOMRect(50, 120, 260, 420));
    window.dispatchEvent(new Event('resize'));
    await flushPlacement();
    expect(notifications?.style.bottom).toBe('236px');
    expect(notifications?.style.width).toBe('236px');
  });

  it('reserves a row inside the modal and dismisses without submitting its form', () => {
    const { panel } = modal();
    const submitted = vi.fn((event: SubmitEvent) => event.preventDefault());
    panel.addEventListener('submit', submitted);
    renderToasts();
    const notice = panel.querySelector<HTMLElement>('.lf-toast');
    const dismiss = notice?.querySelector('button');
    expect(panel.lastElementChild?.className).toBe('lf-toast-dialog-host');
    expect(panel.firstElementChild?.tagName).toBe('H2');
    expect(notice?.querySelector('.lf-toast__message')?.textContent).toBe(
      'Success: Frame complete',
    );
    expect(dismiss?.type).toBe('button');
    act(() => dismiss?.click());
    expect(submitted).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(panel.querySelector('.lf-toast-dialog-host')).toBeNull();
    expect(panel.firstElementChild?.tagName).toBe('H2');
  });

  it('moves the same notices into newly opened modals and restores the canvas placement on close', async () => {
    renderToasts();
    const { backdrop, panel } = modal();
    await flushPlacement();
    expect(panel.querySelector('.lf-toast')?.textContent).toContain('Frame complete');
    expect(document.querySelectorAll('[aria-label="Notifications"]')).toHaveLength(1);
    backdrop.remove();
    await flushPlacement();
    expect(document.querySelector('.lf-toasts--workspace .lf-toast')?.textContent).toContain(
      'Frame complete',
    );
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
