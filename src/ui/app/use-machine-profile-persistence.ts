import { useEffect } from 'react';
import { machineKindOf } from '../../core/scene';
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
        state.project.device === previous.project.device &&
        kind === machineKindOf(previous.project.machine)
      )
        return;
      const saved = storage !== null && rememberLastMachine(storage, state.project.device, kind);
      if (!saved && !warned) {
        warned = true;
        pushToast('Your machine settings could not be saved for next session.', 'warning');
      }
    });
  }, [pushToast]);
}
