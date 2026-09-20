import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStartJobFlow } from '../laser/start-job-flow';
import { installJobShortcuts } from '../laser/use-job-shortcuts';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { useSpacePan } from './use-space-pan';

vi.mock('../laser/start-job-flow', () => ({ runStartJobFlow: vi.fn(async () => undefined) }));

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

  it('leaves native disclosure keys to the browser without panning or starting a job', async () => {
    await renderHarness();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Placement & output';
    details.appendChild(summary);
    host?.appendChild(details);
    summary.focus();
    const { connection, streamer } = useLaserStore.getState();
    useLaserStore.setState({ connection: { kind: 'connected' }, streamer: null });
    const uninstall = installJobShortcuts(window);
    try {
      for (const [key, code] of [
        [' ', 'Space'],
        ['Enter', 'Enter'],
      ] as const) {
        const event = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
        summary.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(useUiStore.getState().spaceDown).toBe(false);
        expect(runStartJobFlow).not.toHaveBeenCalled();
      }
      // The real shortcut listeners are installed: explicit Start still owns
      // Ctrl+Enter, while plain disclosure activation never invokes it.
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      expect(runStartJobFlow).toHaveBeenCalledOnce();
    } finally {
      uninstall();
      useLaserStore.setState({ connection, streamer });
      vi.clearAllMocks();
    }
  });
});
