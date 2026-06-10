import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { PlatformProvider } from './platform-context';
import { useShortcuts } from './use-shortcuts';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockPlatform: PlatformAdapter = {
  id: 'mock',
  pickFilesForOpen: vi.fn(async () => []),
  pickFileForSave: vi.fn(async () => null),
  serial: {
    isSupported: () => false,
    requestPort: vi.fn(async () => null),
  },
};

function ShortcutHarness(): null {
  useShortcuts();
  return null;
}

async function renderHarness(): Promise<() => Promise<void>> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  let root: Root | null = null;
  await act(async () => {
    root = createRoot(host);
    root.render(
      <PlatformProvider adapter={mockPlatform}>
        <ShortcutHarness />
      </PlatformProvider>,
    );
  });
  return async () => {
    if (root !== null) await act(async () => root?.unmount());
    host.remove();
  };
}

async function pressKey(init: KeyboardEventInit & { readonly key: string }): Promise<void> {
  await act(async () => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
}

afterEach(() => {
  useStore.getState().newProject();
  useLaserStore.setState({ streamer: null } as Partial<ReturnType<typeof useLaserStore.getState>>);
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.restoreAllMocks();
});

// H13 (AUDIT-2026-06-10): a native confirm suspends the renderer event loop —
// Pause/Stop unclickable, status poll stopped, ack-driven sends stalled,
// while M3 holds the beam at cut power on a stationary head. The dirty-
// discard confirm must never open while a job is active.
describe('file shortcuts while a job is streaming (H13)', () => {
  it('Ctrl+N does not open a native confirm or discard the project mid-job', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useStore.setState({ dirty: true });
    const project = useStore.getState().project;
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });

    expect(confirm).not.toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);

    await unmount();
  });

  it('Ctrl+N still confirms and resets when no job is active', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useStore.setState({ dirty: true });
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });

    expect(confirm).toHaveBeenCalledTimes(1);

    await unmount();
  });
});
