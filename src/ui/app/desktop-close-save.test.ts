import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  rendererCloseRequestScript,
  type RendererCloseOperation,
} from '../../../electron/renderer-close-request';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { desktopCloseController } from './desktop-close-runtime';
import { installUnloadStop } from './use-unload-stop';
import { installUnsavedChangesGuard } from './use-unsaved-changes-guard';

const initialLaser = useLaserStore.getState();
const initialScene = useStore.getState();
let dispose: () => void = () => undefined;

function install(save?: () => Promise<boolean>): void {
  const unload = installUnloadStop(window, save);
  const unsaved = installUnsavedChangesGuard(window);
  dispose = () => {
    unload();
    unsaved();
  };
}

/** What the main process runs in the window for each close step. */
function fromMain(operation: RendererCloseOperation, id = 1): Promise<unknown> {
  const result: unknown = window.eval(rendererCloseRequestScript(operation, id));
  return Promise.resolve(result);
}

function unloadBlocked(): boolean {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

afterEach(() => {
  dispose();
  dispose = () => undefined;
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
  useStore.setState(initialScene);
});

describe('Save when closing the desktop app (ADR-549)', () => {
  it('saves, then the close is prepared again with the saved project', async () => {
    useStore.setState({ dirty: true });
    const save = vi.fn(async () => {
      useStore.setState({ dirty: false });
      return true;
    });
    install(save);

    expect(await fromMain('prepare')).toEqual({ status: 'ready', dirty: true });
    expect(await fromMain('save')).toEqual({ status: 'saved' });
    // The save changed what was prepared, so main starts the close again.
    expect(await fromMain('approve')).toEqual({ status: 'retry' });
    expect(await fromMain('prepare', 2)).toEqual({ status: 'ready', dirty: false });
    expect(await fromMain('approve', 2)).toEqual({ status: 'approved' });
    expect(unloadBlocked()).toBe(false);
    expect(save).toHaveBeenCalledOnce();
  });

  it('answers cancelled when the save is cancelled or fails, and the work stays unsaved', async () => {
    useStore.setState({ dirty: true });
    const save = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('disk full'));
    install(save);

    await fromMain('prepare');
    expect(await fromMain('save')).toEqual({ status: 'cancelled' });
    expect(await fromMain('save')).toEqual({ status: 'cancelled' });
    await fromMain('cancel');
    // The ordinary unsaved-changes guard still holds the page.
    expect(unloadBlocked()).toBe(true);
  });

  it('saves only for the close it prepared', async () => {
    useStore.setState({ dirty: true });
    const save = vi.fn(async () => true);
    install(save);

    expect(await fromMain('save')).toEqual({ status: 'cancelled' });
    await fromMain('prepare', 3);
    expect(await fromMain('save', 4)).toEqual({ status: 'cancelled' });
    expect(save).not.toHaveBeenCalled();
  });

  it('cancels a save it has no way to run', async () => {
    useStore.setState({ dirty: true });
    install();
    await fromMain('prepare');
    expect(await fromMain('save')).toEqual({ status: 'cancelled' });
  });
});
