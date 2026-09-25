// Export and Import for My machines reuse the `.lfmachine.json` machine-profile
// format, so a file written here also opens in Machine Setup's profile import
// and on another workstation. A file is not bound to this physical machine:
// imported scan offsets arrive marked for a fresh verification burn.

import {
  findSavedMachine,
  importSavedMachine,
  type SavedMachine,
} from '../../core/saved-machines/saved-machine-list';
import { machineKindOf } from '../../core/scene';
import {
  deserializeMachineProfileDocument,
  serializeMachineProfileDocument,
} from '../../io/machine-profile';
import { savedMachineProfileDocument } from '../../io/saved-machines/saved-machine-list-io';
import type { PlatformAdapter } from '../../platform/types';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { commitList, newSavedMachineId } from './saved-machine-actions';

export type SavedMachineImportResult =
  | {
      readonly kind: 'imported';
      readonly machine: SavedMachine;
      readonly notes: ReadonlyArray<string>;
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

export async function importSavedMachineFile(
  platform: Pick<PlatformAdapter, 'pickFilesForOpen'>,
): Promise<SavedMachineImportResult> {
  const [file] = await platform.pickFilesForOpen({ accept: ['.lfmachine.json'], multiple: false });
  if (file === undefined) return { kind: 'cancelled' };
  const result = deserializeMachineProfileDocument(await file.text());
  if (result.kind === 'invalid') return { kind: 'failed', message: result.reason };
  if (result.kind !== 'ok') {
    return { kind: 'failed', message: `Unsupported machine profile version ${result.sawVersion}.` };
  }
  const imported = importSavedMachine(
    useSavedMachinesStore.getState().list,
    result.document.profile,
    {
      newId: newSavedMachineId(),
      now: Date.now(),
      preferredKind: machineKindOf(useStore.getState().project.machine),
    },
  );
  commitList(imported.list);
  return { kind: 'imported', machine: imported.machine, notes: result.document.reviewNotes };
}

export async function exportSavedMachineFile(
  platform: Pick<PlatformAdapter, 'pickFileForSave'>,
  id: string,
): Promise<'saved' | 'cancelled' | 'missing'> {
  const machine = findSavedMachine(useSavedMachinesStore.getState().list, id);
  if (machine === undefined) return 'missing';
  const target = await platform.pickFileForSave({
    suggestedName: `${fileSlug(machine.name)}.lfmachine.json`,
    extensions: ['.lfmachine.json'],
  });
  if (target === null) return 'cancelled';
  await target.write(serializeMachineProfileDocument(savedMachineProfileDocument(machine)));
  return 'saved';
}

function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'machine'
  );
}
