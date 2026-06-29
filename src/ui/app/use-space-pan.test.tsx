import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { useSpacePan } from './use-space-pan';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function Harness(): null {
  useSpacePan();
  return null;
}

async function renderHarness(): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<Harness />);
  });
}

function pressSpace(target: HTMLElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useUiStore.setState({ spaceDown: false });
});

describe('useSpacePan', () => {
  it('sets space-pan state for non-interactive targets', async () => {
    await renderHarness();
    const target = document.createElement('div');
    document.body.appendChild(target);

    const event = pressSpace(target);

    expect(event.defaultPrevented).toBe(true);
    expect(useUiStore.getState().spaceDown).toBe(true);
    target.remove();
  });

  it.each([
    ['button', () => document.createElement('button')],
    ['select', () => document.createElement('select')],
  ])('does not steal Space from %s targets', async (_label, createTarget) => {
    await renderHarness();
    const target = createTarget();
    document.body.appendChild(target);

    const event = pressSpace(target);

    expect(event.defaultPrevented).toBe(false);
    expect(useUiStore.getState().spaceDown).toBe(false);
    target.remove();
  });
});
