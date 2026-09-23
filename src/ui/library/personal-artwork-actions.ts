import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state/store';
import { useToastStore } from '../state/toast-store';
import {
  parsePersonalArtworkLibrary,
  serializePersonalArtworkLibrary,
} from './personal-artwork-format';
import {
  capturePersonalArtwork,
  insertPersonalArtwork,
  type PersonalArtwork,
} from './personal-artwork-model';
import type { PersonalArtworkRepository } from './personal-artwork-storage';

export type PersonalArtworkRun = (
  action: (isCurrent: () => boolean) => Promise<void>,
) => Promise<void>;

export function personalArtworkActions(
  platform: PlatformAdapter,
  storage: PersonalArtworkRepository,
  run: PersonalArtworkRun,
  onClose: () => void,
  onError: (message: string) => void,
) {
  return {
    retry: () => void run(async () => undefined),
    save: (name: string, category: string) =>
      void run(async (isCurrent) => {
        const state = useStore.getState();
        const entry = await capturePersonalArtwork(state, name, category);
        if (!isCurrent()) return;
        await storage.add([entry]);
        if (
          isCurrent() &&
          useStore.getState().projectDocumentEpoch === state.projectDocumentEpoch
        ) {
          useToastStore.getState().pushToast(`Saved ${entry.name} to My artwork.`, 'success');
        }
      }),
    remove: (id: string) => void run(async () => storage.remove(id)),
    importLibrary: () => void run((isCurrent) => importLibrary(platform, storage, isCurrent)),
    exportLibrary: () => void run((isCurrent) => exportLibrary(platform, storage, isCurrent)),
    insert: (entry: PersonalArtwork) => {
      try {
        useStore.setState((state) => insertPersonalArtwork(state, entry));
        useToastStore
          .getState()
          .pushToast(
            `${entry.name} added with its saved operations. Review settings for this machine.`,
            'success',
          );
        onClose();
      } catch (cause) {
        onError(personalArtworkError(cause));
      }
    },
  };
}

async function importLibrary(
  platform: PlatformAdapter,
  storage: PersonalArtworkRepository,
  isCurrent: () => boolean,
): Promise<void> {
  const files = await platform.pickFilesForOpen({ accept: ['.lfart'], multiple: false });
  const file = files[0];
  if (!isCurrent() || file === undefined) return;
  const contents = await file.text();
  if (!isCurrent()) return;
  // Imported records append; they never overwrite local entries with matching IDs.
  const incoming = parsePersonalArtworkLibrary(contents).map((entry) => ({
    ...entry,
    id: crypto.randomUUID(),
  }));
  await storage.add(incoming);
}

async function exportLibrary(
  platform: PlatformAdapter,
  storage: PersonalArtworkRepository,
  isCurrent: () => boolean,
): Promise<void> {
  const json = serializePersonalArtworkLibrary(await storage.list());
  if (!isCurrent()) return;
  const target = await platform.pickFileForSave({
    suggestedName: 'my-artwork.lfart',
    extensions: ['.lfart'],
  });
  if (!isCurrent() || target === null) return;
  await target.write(json);
}

export function personalArtworkError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
