import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useConfirmSaveStore } from '../state/confirm-save-store';
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

async function chooseAndFlush(choice: 'save' | 'discard' | 'cancel'): Promise<void> {
  await act(async () => {
    useConfirmSaveStore.getState().choose(choice);
    // The Save path chains several awaits (choice → saveNow → picker →
    // outcome). A macrotask hop drains the whole microtask queue first.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  useConfirmSaveStore.getState().choose('cancel'); // resolve any dangling request
  useStore.getState().newProject();
  useLaserStore.setState({ streamer: null } as Partial<ReturnType<typeof useLaserStore.getState>>);
  for (const toast of useToastStore.getState().toasts) {
    useToastStore.getState().dismissToast(toast.id);
  }
  vi.restoreAllMocks();
});

// H13 (AUDIT-2026-06-10): the dirty-discard prompt must never open while a
// job is active — its backdrop would cover Pause/Stop with the beam live.
// LU18 replaced the native confirm with the in-app Save / Don't Save /
// Cancel dialog; the fail-closed policy carries over.
describe('file shortcuts while a job is streaming (H13)', () => {
  it('Ctrl+N opens no confirm dialog and keeps the project mid-job', async () => {
    useStore.setState({ dirty: true });
    const project = useStore.getState().project;
    useLaserStore.setState({
      streamer: step(createStreamer('G1 X1 S100')).state,
    } as Partial<ReturnType<typeof useLaserStore.getState>>);
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });

    expect(useConfirmSaveStore.getState().request).toBeNull();
    expect(useStore.getState().project).toBe(project);
    expect(useToastStore.getState().toasts.some((t) => t.message.includes('job is running'))).toBe(
      true,
    );

    await unmount();
  });
});

// LU18 (AUDIT-2026-06-10 / F-A13): the three-way dialog flow when idle.
describe('Ctrl+N dirty-project guard when no job is active (LU18)', () => {
  it("opens the confirm-save request; Don't Save resets the project", async () => {
    useStore.setState({ dirty: true });
    const project = useStore.getState().project;
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });

    const request = useConfirmSaveStore.getState().request;
    expect(request).not.toBeNull();
    expect(request?.action).toBe('start a new project');
    // The project is untouched until the user chooses.
    expect(useStore.getState().project).toBe(project);

    await chooseAndFlush('discard');
    expect(useStore.getState().project).not.toBe(project);
    expect(useConfirmSaveStore.getState().request).toBeNull();

    await unmount();
  });

  it('Cancel keeps the project and resolves nothing else', async () => {
    useStore.setState({ dirty: true });
    const project = useStore.getState().project;
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });
    await chooseAndFlush('cancel');

    expect(useStore.getState().project).toBe(project);

    await unmount();
  });

  it('Save with a cancelled picker aborts the reset (save-cancel aborts)', async () => {
    useStore.setState({ dirty: true, lastSaveTarget: null });
    const project = useStore.getState().project;
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });
    await chooseAndFlush('save'); // mockPlatform's pickFileForSave resolves null

    expect(mockPlatform.pickFileForSave).toHaveBeenCalled();
    expect(useStore.getState().project).toBe(project);

    await unmount();
  });

  it('skips the dialog entirely when the project is clean', async () => {
    useStore.setState({ dirty: false });
    const unmount = await renderHarness();

    await pressKey({ key: 'n', ctrlKey: true });

    expect(useConfirmSaveStore.getState().request).toBeNull();

    await unmount();
  });
});
