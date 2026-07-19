// DeviceSetupControls - one context-aware rail entry for machine configuration.
// The button opens Machine Setup in every state and gains primary emphasis only
// when the connected profile still needs guided setup. This is the single
// explicit setup launch, removing the former pair of near-synonym workflows.

import { useEffect, useState } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { shouldAdvise4040FillPolicySelection } from '../../../core/job/fill-runway-policy';
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
import type { DeviceSetupStep } from './device-setup-flow';
import { DeviceSetupWizard } from './DeviceSetupWizard';

export type DeviceSetupOpenRequest = {
  readonly initialStep: DeviceSetupStep;
};

export function DeviceSetupControls(props: {
  readonly openRequest?: DeviceSetupOpenRequest | undefined;
}): JSX.Element {
  const [machineSetupOpen, setMachineSetupOpen] = useState(false);
  const [initialStep, setInitialStep] = useState<DeviceSetupStep>('identify');
  const [configured, setConfigured] = useState<ReadonlySet<string>>(() => {
    const storage = browserLocalStorage();
    return storage === null ? new Set() : loadConfiguredSignatures(storage);
  });
  const connected = useLaserStore((s) => s.connection.kind === 'connected');
  const device = useStore((s) => s.project.device);
  const needsSetup = shouldPromptDeviceSetup({ connected, device, configured });
  const needs4040ProfileReview = connected && shouldAdvise4040FillPolicySelection(device);
  useEffect(() => {
    if (props.openRequest === undefined) return;
    setInitialStep(props.openRequest.initialStep);
    setMachineSetupOpen(true);
  }, [props.openRequest]);
  const openSetup = (step: DeviceSetupStep): void => {
    setInitialStep(step);
    setMachineSetupOpen(true);
  };
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
        variant={needsSetup || needs4040ProfileReview ? 'primary' : 'default'}
        onClick={() => openSetup('identify')}
        {...helpProps('control:laser.machine-setup.launch')}
      >
        Machine Setup
      </Button>
      {needsSetup && (
        <p style={mutedNoteStyle} role="note">
          This machine isn&apos;t set up yet.
        </p>
      )}
      {needs4040ProfileReview && (
        <p style={warningNoteStyle} role="note">
          4040 fill-quality policy is inactive because {device.name} is selected. KerfDesk cannot
          identify a Neotronics 4040 from its work area or controller settings. If this is that
          machine, open Machine Setup, choose the Neotronics 4040 profile, review it, and Save
          before the next Scanline Fill.
        </p>
      )}
      {machineSetupOpen && (
        <DeviceSetupWizard
          initialStep={initialStep}
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
const warningNoteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 11,
  lineHeight: 1.4,
  color: 'var(--lf-warning-fg)',
};
