import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import { studioDocument } from '../../io/project/studio-document.test-fixture';
import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { useConfirmSaveStore } from '../state/confirm-save-store';
import { resetStore } from '../state/test-helpers';
import { confirmDiscardAsync } from './confirm-discard';
import { registerProjectSaveCheckpoint } from './project-save-checkpoint';
import { desktopCloseController, installDesktopCloseReceiver } from './desktop-close-runtime';
import type { DesktopCloseReply } from './desktop-close-controller';

let unregister: (() => void) | undefined;
let dispose: (() => void) | undefined;
const initialLaser = useLaserStore.getState();
beforeEach(() => {
  resetStore();
  desktopCloseController.keepOpen();
});
afterEach(() => {
  unregister?.();
  dispose?.();
  unregister = undefined;
  dispose = undefined;
  useConfirmSaveStore.getState().choose('cancel');
  desktopCloseController.keepOpen();
  useLaserStore.setState(initialLaser);
});

function close(operation: 'prepare' | 'approve' = 'prepare'): Promise<DesktopCloseReply> {
  return new Promise((respond) =>
    window.dispatchEvent(
      new CustomEvent('kerfdesk:desktop-close', {
        detail: { operation, requestId: 123, respond },
        cancelable: true,
      }),
    ),
  );
}

function capture(): void {
  unregister = registerProjectSaveCheckpoint(async (owner) => {
    useStore.getState().upsertStudioDocument(studioDocument(), owner.projectDocumentEpoch);
    return undefined;
  });
}

describe('native editor capture before a project discard decision', () => {
  it('New/Open discovers native edits even when the KerfDesk project was clean', async () => {
    capture();
    const result = confirmDiscardAsync(mockPlatform(), 'open another project');
    await vi.waitFor(() => expect(useConfirmSaveStore.getState().request).not.toBeNull());
    expect(useStore.getState().project.studioDocuments).toHaveLength(1);
    useConfirmSaveStore.getState().choose('cancel');
    expect(await result).toBe(false);
  });

  it('keeps New/Open and desktop Close stopped when native source cannot be captured', async () => {
    unregister = registerProjectSaveCheckpoint(async () => {
      throw new Error('Native editor unavailable');
    });
    expect(await confirmDiscardAsync(mockPlatform(), 'start a new project')).toBe(false);
    expect(useConfirmSaveStore.getState().request).toBeNull();
    dispose = installDesktopCloseReceiver(window);
    expect(await close()).toEqual({ status: 'cancelled' });
    expect(desktopCloseController.ownsUnload).toBe(false);
  });

  it('desktop Close asks about captured native changes before permitting discard', async () => {
    capture();
    dispose = installDesktopCloseReceiver(window);
    expect(await close()).toEqual({ status: 'ready', dirty: true });
    expect(await close('approve')).toEqual({ status: 'approved' });
  });

  it('begins existing Fire-off immediately while waiting for native checkpoint', async () => {
    let release: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    unregister = registerProjectSaveCheckpoint(async () => {
      await waiting;
      return undefined;
    });
    const fireOff = vi.fn(async () => {
      useLaserStore.setState({ fireActive: false });
    });
    useLaserStore.setState({ fireActive: true, setFireActive: fireOff });
    dispose = installDesktopCloseReceiver(window);
    const closing = close();
    expect(fireOff).toHaveBeenCalledWith(false);
    release();
    expect(await closing).toEqual({ status: 'ready', dirty: false });
  });
});
