// The status bar's Notices control (annoyance audit A5-P2-6, ADR-708).
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoticeHistory } from '../state/notice-history';
import { useToastStore } from '../state/toast-store';
import { formatNoticeTime, NoticeHistoryButton } from './NoticeHistoryButton';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(async () => {
  useNoticeHistory.getState().clearNotices();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<NoticeHistoryButton />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  useNoticeHistory.getState().clearNotices();
  vi.useRealTimers();
  document.body.replaceChildren();
});

async function push(
  message: string,
  variant: 'info' | 'success' | 'warning' | 'error',
  details?: ReadonlyArray<string>,
): Promise<void> {
  await act(async () =>
    useToastStore.getState().pushToast(message, variant, details === undefined ? {} : { details }),
  );
}

const button = (): HTMLButtonElement | null =>
  host.querySelector<HTMLButtonElement>('.lf-notice-history__button');
const panel = (): HTMLElement | null =>
  host.querySelector<HTMLElement>('[role="region"][aria-label="Notices from this session"]');
const rows = (): ReadonlyArray<string> =>
  [...host.querySelectorAll('.lf-notice-history__message')].map((row) => row.textContent ?? '');

async function click(element: Element | null): Promise<void> {
  if (element === null) throw new Error('nothing to click');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('NoticeHistoryButton', () => {
  it('is absent until a warning or error has been shown', async () => {
    expect(button()).toBeNull();
    await push('Saved', 'success');
    await push('Importing logo.svg', 'info');
    expect(button()).toBeNull();
    await push('Check the fixture', 'warning');
    expect(button()?.textContent).toBe('Notices (1 new)');
    expect(button()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('lists the notices newest first, after their toasts have gone', async () => {
    vi.useFakeTimers();
    await push('Check the fixture', 'warning');
    await push('Could not save', 'error');
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(useToastStore.getState().toasts).toEqual([]);

    await click(button());
    expect(button()?.getAttribute('aria-expanded')).toBe('true');
    expect(button()?.getAttribute('aria-controls')).toBe(panel()?.id);
    expect(rows()).toEqual(['Could not save', 'Check the fixture']);
    const labels = [...host.querySelectorAll('.lf-notice-history__meta strong')].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual(['Error', 'Warning']);
  });

  it('shows folded notes in the open and how often a notice repeated', async () => {
    await push('Opened old.lf2. 2 warnings below.', 'warning', ['First note', 'Second note']);
    for (let click = 0; click < 3; click += 1) await push('Jog target is outside', 'warning');
    await click(button());
    const details = [...host.querySelectorAll('.lf-notice-history__details li')].map(
      (line) => line.textContent,
    );
    expect(details).toEqual(['First note', 'Second note']);
    expect(host.querySelector('.lf-notice-history__meta')?.textContent).toContain('shown 3 times');
  });

  it('marks the notices read when the list opens, and keeps new ones read while open', async () => {
    await push('Check the fixture', 'warning');
    await click(button());
    expect(button()?.textContent).toBe('Notices');
    await push('Another', 'warning');
    expect(rows()).toEqual(['Another', 'Check the fixture']);
    expect(useNoticeHistory.getState().unseen).toBe(0);
    await click(button());
    expect(panel()).toBeNull();
    expect(button()?.textContent).toBe('Notices');
  });

  it('closes on Escape and returns focus to the control', async () => {
    await push('Check the fixture', 'warning');
    await click(button());
    expect(document.activeElement).toBe(panel());
    const seenByWindow = vi.fn();
    window.addEventListener('keydown', seenByWindow);
    await act(async () => {
      panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    window.removeEventListener('keydown', seenByWindow);
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button());
    // The key stays in the list: it never reaches the window's shortcuts.
    expect(seenByWindow).not.toHaveBeenCalled();
  });

  it('keeps arrow keys from the window so they cannot nudge or jog', async () => {
    await push('Check the fixture', 'warning');
    await click(button());
    const seenByWindow = vi.fn();
    window.addEventListener('keydown', seenByWindow);
    await act(async () => {
      panel()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    window.removeEventListener('keydown', seenByWindow);
    expect(seenByWindow).not.toHaveBeenCalled();
    expect(panel()).not.toBeNull();
  });

  it('closes on a press outside it', async () => {
    await push('Check the fixture', 'warning');
    await click(button());
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(panel()).toBeNull();
  });

  it('Clear empties the list and removes the control', async () => {
    await push('Check the fixture', 'warning');
    await click(button());
    const clear = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Clear');
    await click(clear ?? null);
    expect(useNoticeHistory.getState().notices).toEqual([]);
    expect(button()).toBeNull();
    expect(panel()).toBeNull();
  });

  it('stays inside the canvas area and above the Live Motion popup', async () => {
    const workspace = document.createElement('div');
    workspace.setAttribute('data-toast-workspace', '');
    const box = {
      left: 300,
      right: 900,
      top: 80,
      bottom: 700,
      width: 600,
      height: 620,
      x: 300,
      y: 80,
    };
    workspace.getBoundingClientRect = () => ({ ...box, toJSON: () => box });
    const liveMotion = document.createElement('div');
    liveMotion.setAttribute('aria-label', 'Live Motion');
    const popup = {
      left: 300,
      right: 900,
      top: 600,
      bottom: 690,
      width: 600,
      height: 90,
      x: 300,
      y: 600,
    };
    liveMotion.getBoundingClientRect = () => ({ ...popup, toJSON: () => popup });
    document.body.append(workspace, liveMotion);
    Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });

    await push('Check the fixture', 'warning');
    await click(button());
    const style = panel()?.style;
    // Right edge 12 px inside the canvas area, not over the right rail.
    expect(style?.right).toBe('312px');
    // Bottom edge 12 px above the popup that holds Abort (768 - 600 + 12).
    expect(style?.bottom).toBe('180px');
    expect(style?.width).toBe('380px');
  });
});

describe('formatNoticeTime', () => {
  it('shows hours and minutes on the local clock', () => {
    expect(formatNoticeTime(new Date(2026, 10, 11, 9, 5).getTime())).toBe('09:05');
    expect(formatNoticeTime(new Date(2026, 10, 11, 17, 42).getTime())).toBe('17:42');
  });
});
