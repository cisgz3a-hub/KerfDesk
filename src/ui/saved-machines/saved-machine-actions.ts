// My machines actions (ADR-374). List changes are written through to this
// workstation at once. Only saving the open machine as a new entry touches the
// project, and then only to record which entry it is (an undoable label edit).

import type { ControllerFingerprint } from '../../core/saved-machines/controller-fingerprint';
import {
  addSavedMachine,
  createSavedMachine,
  duplicateSavedMachine,
  findSavedMachine,
  removeSavedMachine,
  renameSavedMachine,
  savedMachineNameIssue,
  setDefaultSavedMachine,
  uniqueSavedMachineName,
  updateSavedMachineProfile,
  type SavedMachine,
  type SavedMachineList,
} from '../../core/saved-machines/saved-machine-list';
import { machineKindOf } from '../../core/scene';
import { useStore } from '../state';
import { useSavedMachinesStore } from '../state/saved-machines-store';
import { useToastStore } from '../state/toast-store';
import { connectedControllerFingerprint } from './saved-machine-connection';

export const STORAGE_FAILED_MESSAGE =
  'My machines could not be written to this workstation (storage is full or blocked). The change lasts only until KerfDesk closes.';

export function newSavedMachineId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (typeof cryptoApi?.randomUUID === 'function') return `machine-${cryptoApi.randomUUID()}`;
  return `machine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Add the open project's machine to My machines and mark the project as using it. */
export function saveCurrentMachineAsNew(options: {
  readonly rememberController: boolean;
}): SavedMachine {
  const app = useStore.getState();
  const list = useSavedMachinesStore.getState().list;
  const machine = createSavedMachine({
    id: newSavedMachineId(),
    profile: app.project.device,
    machineKind: machineKindOf(app.project.machine),
    name: uniqueSavedMachineName(list, app.project.device.name),
    controllerFingerprint: rememberedController(options.rememberController),
    now: Date.now(),
  });
  commitList(addSavedMachine(list, machine));
  app.updateDeviceProfile({ savedMachineId: machine.id, name: machine.name });
  return machine;
}

/** Overwrite a saved machine with the open project's copy. The project is not
 * changed; it already names this entry. */
export function saveProjectCopyToSavedMachine(
  id: string,
  options: { readonly rememberController: boolean },
): boolean {
  const app = useStore.getState();
  const list = useSavedMachinesStore.getState().list;
  if (findSavedMachine(list, id) === undefined) return false;
  commitList(
    updateSavedMachineProfile(list, id, {
      profile: app.project.device,
      machineKind: machineKindOf(app.project.machine),
      controllerFingerprint: rememberedController(options.rememberController),
      now: Date.now(),
    }),
  );
  return true;
}

/** Rename an entry; returns why it could not be renamed, or null. */
export function renameMachine(id: string, name: string): string | null {
  const list = useSavedMachinesStore.getState().list;
  const issue = savedMachineNameIssue(list, name, id);
  if (issue !== null) return issue;
  commitList(renameSavedMachine(list, id, name, Date.now()));
  return null;
}

export function duplicateMachine(id: string): void {
  const list = useSavedMachinesStore.getState().list;
  commitList(duplicateSavedMachine(list, id, newSavedMachineId(), Date.now()));
}

/** Projects that used the entry keep their own copy and simply stop naming a
 * saved machine that exists here. */
export function removeMachine(id: string): void {
  commitList(removeSavedMachine(useSavedMachinesStore.getState().list, id));
}

export function setDefaultMachine(id: string | null): void {
  commitList(setDefaultSavedMachine(useSavedMachinesStore.getState().list, id));
}

export function commitList(list: SavedMachineList): void {
  const store = useSavedMachinesStore.getState();
  if (list === store.list) return;
  if (!store.commit(list)) useToastStore.getState().pushToast(STORAGE_FAILED_MESSAGE, 'warning');
}

function rememberedController(remember: boolean): ControllerFingerprint | undefined {
  if (!remember) return undefined;
  return connectedControllerFingerprint() ?? undefined;
}
