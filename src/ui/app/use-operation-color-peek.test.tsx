import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { OPERATION_COLOR_PEEK_DELAY_MS, useOperationColorPeek } from './use-operation-color-peek';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function Harness(): null {
  useOperationColorPeek();
  return null;
}

function key(type: 'keydown' | 'keyup', init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(event);
  return event;
}

const peek = (): boolean => useUiStore.getState().operationColorPeek;

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<Harness />);
  });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  vi.useRealTimers();
  useUiStore.setState({ operationColorPeek: false });
});

describe('useOperationColorPeek', () => {
  it('shows operation colours while Alt is held and returns to ink on release', () => {
    key('keydown', { key: 'Alt', altKey: true });
    expect(peek()).toBe(false);
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS);
    expect(peek()).toBe(true);
    const release = key('keyup', { key: 'Alt' });
    expect(peek()).toBe(false);
    // The peek used this Alt press, so the browser menu must not take focus.
    expect(release.defaultPrevented).toBe(true);
  });

  it('never flashes colours for a quick Alt tap or an Alt shortcut', () => {
    key('keydown', { key: 'Alt', altKey: true });
    const tap = key('keyup', { key: 'Alt' });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS * 2);
    expect(peek()).toBe(false);
    expect(tap.defaultPrevented).toBe(false);

    key('keydown', { key: 'Alt', altKey: true });
    key('keydown', { key: 'ArrowLeft', altKey: true });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS * 2);
    expect(peek()).toBe(false);
  });

  it('never peeks during an Alt click or drag, where Alt serves the gesture', () => {
    key('keydown', { key: 'Alt', altKey: true });
    window.dispatchEvent(new MouseEvent('pointerdown', { altKey: true, bubbles: true }));
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS * 2);
    expect(peek()).toBe(false);
    key('keyup', { key: 'Alt' });

    // An Alt-drag begun after the peek showed ends it.
    key('keydown', { key: 'Alt', altKey: true });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS);
    expect(peek()).toBe(true);
    window.dispatchEvent(new MouseEvent('pointerdown', { altKey: true, bubbles: true }));
    expect(peek()).toBe(false);
  });

  it('never peeks when Alt joins a drag already under way', () => {
    // A plain press starts a snapping drag; Alt pressed later turns snapping off.
    window.dispatchEvent(new MouseEvent('pointerdown', { buttons: 1, bubbles: true }));
    key('keydown', { key: 'Alt', altKey: true });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS * 2);
    expect(peek()).toBe(false);
    key('keyup', { key: 'Alt' });
    window.dispatchEvent(new MouseEvent('pointerup', { buttons: 0, bubbles: true }));

    // With the mouse up again, holding Alt peeks as usual.
    key('keydown', { key: 'Alt', altKey: true });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS);
    expect(peek()).toBe(true);
    // An Alt-modified move with a button held ends it.
    window.dispatchEvent(
      new MouseEvent('pointermove', { altKey: true, buttons: 1, bubbles: true }),
    );
    expect(peek()).toBe(false);
  });

  it('ends the peek when the window loses focus mid-hold', () => {
    key('keydown', { key: 'Alt', altKey: true });
    vi.advanceTimersByTime(OPERATION_COLOR_PEEK_DELAY_MS);
    expect(peek()).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(peek()).toBe(false);
  });
});
