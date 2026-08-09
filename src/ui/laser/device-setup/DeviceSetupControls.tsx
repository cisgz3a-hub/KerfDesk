// DeviceSetupControls - one context-aware rail entry for machine configuration.
// The button opens Machine Setup in every state and gains primary emphasis only
// when the connected profile still needs guided setup. This is the single
// explicit setup launch, removing the former pair of near-synonym workflows.

import { useEffect, useState } from 'react';
import { helpProps } from '../../help/help-topics';
import { Button } from '../../kit';
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
  const needsSetup = shouldPromptDeviceSetup({ connected, device, configured });
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
      >
        Machine Setup
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
