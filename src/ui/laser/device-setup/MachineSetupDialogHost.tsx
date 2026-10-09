import { useEffect } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { machineKindOf } from '../../../core/scene';
import { useStore } from '../../state';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
  persistConfiguredSignatures,
} from '../../state/device-setup-configured-persistence';
import { rememberLastMachine } from '../../state/last-machine-persistence';
import { deviceProfileSignature } from './device-setup-nudge';
import {
  machineSetupHighlight,
  machineSetupInitialStep,
  useMachineSetupDialogStore,
} from './machine-setup-dialog-store';
import { DeviceSetupWizard } from './DeviceSetupWizard';

/** App-level host for every Machine Setup entry point. */
export function MachineSetupDialogHost(): JSX.Element | null {
  const dialog = useMachineSetupDialogStore((store) => store.state);
  const documentEpoch = useStore((store) => store.projectDocumentEpoch);
  const close = useMachineSetupDialogStore((store) => store.close);
  const configurationRecorded = useMachineSetupDialogStore((store) => store.configurationRecorded);
  useEffect(() => close, [close]);
  if (dialog.kind !== 'open') return null;
  const closeDraft = (): void => {
    // Firmware verification can finish after another document or setup opens.
    // Only the exact original draft may close; request IDs can be reused later.
    if (
      useStore.getState().projectDocumentEpoch === documentEpoch &&
      useMachineSetupDialogStore.getState().state === dialog
    ) {
      close();
    }
  };
  const markConfigured = (profile: DeviceProfile): void => {
    persistConfiguredProfile(profile);
    configurationRecorded();
  };
  return (
    <DeviceSetupWizard
      key={dialog.requestId}
      initialStep={machineSetupInitialStep(dialog.target)}
      highlight={machineSetupHighlight(dialog.target)}
      target={dialog.target}
      connection={dialog.connection}
      onClose={closeDraft}
      onConfigured={markConfigured}
    />
  );
}

function persistConfiguredProfile(profile: DeviceProfile): void {
  const storage = browserLocalStorage();
  if (storage === null) return;
  const configured = new Set(loadConfiguredSignatures(storage));
  // Save has already applied the setup, so the project's mode is the one set up.
  configured.add(
    deviceProfileSignature(profile, machineKindOf(useStore.getState().project.machine)),
  );
  persistConfiguredSignatures(storage, configured);
  // ADR-500 Amendment 1: restore the saved profile and selected head on restart.
  rememberLastMachine(storage, profile, machineKindOf(useStore.getState().project.machine));
}
