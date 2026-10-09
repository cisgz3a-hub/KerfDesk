// DeviceSetupControls - one context-aware rail entry for machine configuration.
// The button opens Machine Setup in every state and gains primary emphasis only
// when the connected profile still needs guided setup. Explicit first Connect
// opens this same global workflow; other connections keep the passive nudge.

import { useEffect, useState } from 'react';
import { machineKindOf } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button, Icon } from '../../kit';
import { useStore } from '../../state';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
} from '../../state/device-setup-configured-persistence';
import { useLaserStore } from '../../state/laser-store';
import { shouldPromptDeviceSetup } from './device-setup-nudge';
import { openMachineSetup, useMachineSetupDialogStore } from './machine-setup-dialog-store';

export function DeviceSetupControls(): JSX.Element {
  const [configured, setConfigured] = useState<ReadonlySet<string>>(() => {
    const storage = browserLocalStorage();
    return storage === null ? new Set() : loadConfiguredSignatures(storage);
  });
  const configuredRevision = useMachineSetupDialogStore((store) => store.configuredRevision);
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const needsSetup = shouldPromptDeviceSetup({ connected, device, machineKind, configured });
  useEffect(() => {
    const storage = browserLocalStorage();
    setConfigured(storage === null ? new Set() : loadConfiguredSignatures(storage));
  }, [configuredRevision]);
  return (
    <>
      <Button
        variant={needsSetup ? 'primary' : 'default'}
        onClick={() => openMachineSetup()}
        {...helpProps('control:laser.machine-setup.launch')}
        aria-label="Machine Setup"
      >
        <Icon name="sliders" size={16} />
      </Button>
      {needsSetup && (
        <p style={mutedNoteStyle} role="note">
          This machine isn&apos;t set up yet.
        </p>
      )}
    </>
  );
}

const mutedNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: 'var(--lf-text-muted)',
};
