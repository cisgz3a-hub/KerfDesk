import { useEffect } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
  persistConfiguredSignatures,
} from '../../state/device-setup-configured-persistence';
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
  const close = useMachineSetupDialogStore((store) => store.close);
  const configurationRecorded = useMachineSetupDialogStore((store) => store.configurationRecorded);
  useEffect(() => close, [close]);
  if (dialog.kind !== 'open') return null;
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
      onClose={close}
      onConfigured={markConfigured}
    />
  );
}

function persistConfiguredProfile(profile: DeviceProfile): void {
  const storage = browserLocalStorage();
  if (storage === null) return;
  const configured = new Set(loadConfiguredSignatures(storage));
  configured.add(deviceProfileSignature(profile));
  persistConfiguredSignatures(storage, configured);
}
