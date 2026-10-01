import { useEffect } from 'react';
import type { DeviceProfile } from '../../core/devices';
import { machineKindOf, type Project } from '../../core/scene';
import { useStore } from '../state';
import { browserLocalStorage } from '../state/browser-local-storage';
import { rememberLastMachine } from '../state/last-machine-persistence';
import { useToastStore } from '../state/toast-store';

export function useMachineProfilePersistence(): void {
  const pushToast = useToastStore((state) => state.pushToast);
  useEffect(() => {
    const storage = browserLocalStorage();
    let warned = false;
    return useStore.subscribe((state, previous) => {
      // Opening/recovering a file applies that document's hardware, but must not
      // silently replace the independently saved application machine choice.
      if (state.projectDocumentEpoch !== previous.projectDocumentEpoch) return;
      const kind = machineKindOf(state.project.machine);
      if (
        kind === machineKindOf(previous.project.machine) &&
        ((state.project.device === previous.project.device &&
          state.project.machine === previous.project.machine) ||
          sameProfileValue(persistableProfile(state.project), persistableProfile(previous.project)))
      )
        return;
      const saved =
        storage !== null && rememberLastMachine(storage, persistableProfile(state.project), kind);
      if (!saved && !warned) {
        warned = true;
        pushToast('Your machine settings could not be saved for next session.', 'warning');
      }
    });
  }, [pushToast]);
}

function persistableProfile(project: Project): DeviceProfile {
  // CNC job edits clone the device and mirror active params into cncSubProfile.
  // Compare the effective hardware values, including for older files without
  // that mirror, so stock/tool/tiling edits cannot adopt the file's machine.
  return project.machine?.kind === 'cnc'
    ? { ...project.device, cncSubProfile: project.machine.params }
    : project.device;
}

function sameProfileValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || left === null || typeof right !== 'object' || right === null)
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameProfileValue(value, right[index]))
    );
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  return (
    keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
    keys.every((key) => sameProfileValue(a[key], b[key]))
  );
}
