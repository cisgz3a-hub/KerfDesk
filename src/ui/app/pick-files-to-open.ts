import type { FileHandle, FileOpenRequest, PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import {
  useSaveReadyDialogStore,
  type SaveReadyDialogRequest,
} from '../state/save-ready-dialog-store';
import { platformCanPickFiles } from './browser-file-access';
import { hasPickerActivation } from './pick-prepared-save-target';

export type OpenAfterWait = {
  /** Title of the fresh-click dialog, e.g. "Open project". */
  readonly title: string;
  /** What Choose file… picks, e.g. "the project to open". */
  readonly choice: string;
  /** Whether this Open is still the one to carry out. Asked while the dialog
   * waits and again at the fresh click, which can come long after the Open was
   * asked for; false closes the dialog and opens no picker. */
  readonly stillWanted: () => boolean;
};

/** Choose the file an Open reads, after whatever the Open had to wait for
 * (ADR-656 Amendment 5).
 *
 * An Open over unsaved work runs on the click that answered Save changes?.
 * Chromium opens a picker only within 5 s of that click, and a save picker
 * left open for longer, or a slow write, outlasts it. The open picker is then
 * refused, in the browser and the desktop app alike. So when the activation has
 * lapsed this asks for a fresh Choose file… click and opens the picker inside
 * it. While the activation is live the picker opens at once, with no dialog.
 *
 * Resolves no files when the operator cancels, or when the Open stops being
 * wanted before the picker opens. */
export async function pickFilesToOpen(
  platform: Pick<PlatformAdapter, 'pickFilesForOpen' | 'filePickersAvailable'>,
  openRequest: FileOpenRequest,
  wait: OpenAfterWait,
): Promise<ReadonlyArray<FileHandle>> {
  // A browser with no file pickers says so at once; a click would not help it.
  if (hasPickerActivation() || !platformCanPickFiles(platform))
    return platform.pickFilesForOpen(openRequest);
  if (!wait.stillWanted()) return [];
  return new Promise<ReadonlyArray<FileHandle>>((resolve, reject) => {
    const store = useSaveReadyDialogStore.getState;
    let request: SaveReadyDialogRequest;
    let stopWatching = (): void => undefined;
    const finish = (): void => {
      stopWatching();
      store().close(request);
    };
    const cancel = (): void => {
      if (request.phase === 'choosing') return;
      finish();
      resolve([]);
    };
    const choose = (): void => {
      if (request.phase !== 'ready') return;
      if (!wait.stillWanted()) {
        cancel();
        return;
      }
      request = { ...request, phase: 'choosing' };
      store().show(request);
      // The platform opens its picker synchronously, inside this click.
      platform.pickFilesForOpen(openRequest).then(
        (files) => {
          finish();
          resolve(files);
        },
        (error: unknown) => {
          finish();
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    };
    request = {
      title: wait.title,
      message: `${savedLine()}Choose ${wait.choice}.`,
      picks: 'open',
      phase: 'ready',
      cancel,
      choose,
    };
    // Another Open, New or a recovery can take the document while this waits.
    stopWatching = useStore.subscribe(() => {
      if (!wait.stillWanted()) cancel();
    });
    store().show(request);
  });
}

/** Says the project is saved only when it is: Don't Save also leads here. */
function savedLine(): string {
  const { dirty, savedName } = useStore.getState();
  return dirty || savedName === null ? '' : `${savedName} is saved. `;
}
