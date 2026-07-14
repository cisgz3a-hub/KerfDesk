// DeviceSetupControls - one context-aware rail entry for machine configuration.
// The button opens Machine Setup in every state and gains primary emphasis only
// when the connected profile still needs guided setup. This is the single
// explicit setup launch, removing the former pair of near-synonym workflows.

import { useState } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
import { useStore } from '../../state';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
  persistConfiguredSignatures,
} from '../../state/device-setup-configured-persistence';
import { useLaserStore } from '../../state/laser-store';
import { deviceProfileSignature, shouldPromptDeviceSetup } from './device-setup-nudge';
import { DeviceSetupWizard } from './DeviceSetupWizard';

export function DeviceSetupControls(): JSX.Element {
  const [machineSetupOpen, setMachineSetupOpen] = useState(false);
  const [configured, setConfigured] = useState<ReadonlySet<string>>(() => {
    const storage = browserLocalStorage();
    return storage === null ? new Set() : loadConfiguredSignatures(storage);
  });
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const device = useStore((s) => s.project.device);
  const needsSetup = shouldPromptDeviceSetup({ connected, device, configured });
  const markConfigured = (profile: DeviceProfile): void => {
    const next = new Set(configured);
    next.add(deviceProfileSignature(profile));
    setConfigured(next);
    const storage = browserLocalStorage();
    if (storage !== null) persistConfiguredSignatures(storage, next);
  };
  return (
    <>
      <Button
        variant={needsSetup ? 'primary' : 'default'}
        onClick={() => setMachineSetupOpen(true)}
        {...helpProps('control:laser.machine-setup.launch')}
      >
        Machine Setup
      </Button>
      {needsSetup && (
        <p style={mutedNoteStyle} role="note">
          This machine isn&apos;t set up yet.
        </p>
      )}
      {machineSetupOpen && (
        <DeviceSetupWizard
          onClose={() => setMachineSetupOpen(false)}
          onConfigured={markConfigured}
        />
      )}
    </>
  );
}

const mutedNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
