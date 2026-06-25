// DeviceSetupControls — the Laser-rail entry points for machine configuration:
// the guided "Set up device" wizard (with a passive nudge when the connected
// machine's active profile has not been set up yet) and the advanced Machine
// Setup dialog. Extracted from LaserWindow so that component stays within its
// size/complexity budget and the device-setup UI lives with the rest of the
// feature. The nudge never auto-opens anything (FU-4).

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
import { MachineSetupDialog } from '../MachineSetupDialog';
import { deviceProfileSignature, shouldPromptDeviceSetup } from './device-setup-nudge';
import { DeviceSetupWizard } from './DeviceSetupWizard';

export function DeviceSetupControls(): JSX.Element {
  const [machineSetupOpen, setMachineSetupOpen] = useState(false);
  const [deviceSetupOpen, setDeviceSetupOpen] = useState(false);
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
        variant="primary"
        onClick={() => setDeviceSetupOpen(true)}
        {...helpProps('control:laser.device-setup.launch')}
      >
        Set up device
      </Button>
      {needsSetup && (
        <p style={nudgeStyle} role="note">
          This machine isn&apos;t set up yet — run Set up device.
        </p>
      )}
      <Button onClick={() => setMachineSetupOpen(true)}>Machine Setup</Button>
      {deviceSetupOpen && (
        <DeviceSetupWizard
          onClose={() => setDeviceSetupOpen(false)}
          onConfigured={markConfigured}
        />
      )}
      {machineSetupOpen && <MachineSetupDialog onClose={() => setMachineSetupOpen(false)} />}
    </>
  );
}

const nudgeStyle: React.CSSProperties = { margin: 0, fontSize: 11, color: 'var(--lf-text-muted)' };
