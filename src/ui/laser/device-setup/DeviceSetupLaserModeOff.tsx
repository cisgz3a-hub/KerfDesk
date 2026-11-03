// A laser whose controller reports laser mode off ($32=0, stock GRBL's
// default) is asked, in plain words, to turn it on (UX audit U8-P2-1, ADR-637
// Amendment 7). `$32` cannot tell a laser from a router, so the type stays the
// one chosen and CNC is offered only as the operator's own answer. The write
// saves a backup of the controller settings first, confirms, and then uses
// Machine Settings' guarded write and read-back; the question leaves once the
// controller reports laser mode on.

import { useState } from 'react';
import { machineKindOf } from '../../../core/scene';
import { usePlatform } from '../../app/platform-context';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { jobAwareConfirm } from '../../state/job-aware-dialogs';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { exportGrblSettingsBackup } from '../export-grbl-settings-backup';
import { LASER_MODE_ON_EFFECT, writeLaserModeOn } from '../laser-mode-write';
import type {
  DeviceSetupAction,
  DeviceSetupState,
  DeviceSetupStepProps,
} from './device-setup-flow';

export const LASER_MODE_OFF_QUESTION =
  'Your controller has laser mode off ($32=0). Lasers need it on, or the beam pauses and burns dots at every power change. Turn it on now?';

export const LASER_MODE_NOT_CHANGED_NO_BACKUP =
  'Laser mode was not changed: the controller settings backup was not saved.';

export function setupLaserModePrompt(backupName: string): string {
  return `Write $32=1 to the controller?\n\nThe current controller settings were saved to ${backupName}. ${LASER_MODE_ON_EFFECT}`;
}

export function DeviceSetupLaserModeOff({
  state,
  dispatch,
}: DeviceSetupStepProps): JSX.Element | null {
  const laserModeOff = useLaserStore((s) => s.detectedSettings?.laserModeEnabled === false);
  if (!laserModeOff || !laserOnly(state)) return null;
  return (
    <div className="lf-setup-laser-mode-off" role="status" aria-live="polite">
      <strong>{LASER_MODE_OFF_QUESTION}</strong>
      <LaserModeFix />
      <Button onClick={() => routerAnswerActions(state).forEach(dispatch)}>
        This is a CNC router
      </Button>
    </div>
  );
}

function laserOnly(state: DeviceSetupState): boolean {
  return state.machineKinds.length === 1 && state.machineKinds[0] === 'laser';
}

// The operator's own answer replaces the type, and the values the fill took
// from the controller reach the router's head as they would have on a router.
export function routerAnswerActions(state: DeviceSetupState): ReadonlyArray<DeviceSetupAction> {
  const router: DeviceSetupAction = { kind: 'set-machine-kinds', machineKinds: ['cnc'] };
  return state.detectedApplied
    ? [router, { kind: 'accept-detected', patch: state.detected, keepWorkArea: true }]
    : [router];
}

function LaserModeFix(): JSX.Element {
  const settings = useLaserStore((s) => s.capabilities.settings);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const operationBusy = useLaserStore((s) => s.controllerOperation !== null);
  // The write rule follows the open project: a router project never writes
  // laser mode on (ADR-180 Amendment 6), so it is saved as a laser first.
  const laserProject = useStore((s) => machineKindOf(s.project.machine) === 'laser');
  const platform = usePlatform();
  const [busy, setBusy] = useState(false);
  if (settings === 'readonly-dump') {
    return (
      <p className="lf-setup-muted">
        FluidNC sets laser mode from its spindle type: set the spindle to Laser in the FluidNC
        config file.
      </p>
    );
  }
  if (settings !== 'grbl-dollar') {
    return (
      <p className="lf-setup-muted">
        KerfDesk does not write settings to this controller. Turn laser mode on with the controller
        maker&apos;s tools.
      </p>
    );
  }
  const turnOn = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      // The file picker opens on the click itself, as Export backup does.
      const backup = await exportGrblSettingsBackup({ platform, rows });
      const pushToast = useToastStore.getState().pushToast;
      if (!backup.ok) {
        pushToast(
          backup.reason === 'cancelled' ? LASER_MODE_NOT_CHANGED_NO_BACKUP : backup.message,
          backup.reason === 'cancelled' ? 'info' : 'error',
        );
        return;
      }
      if (backup.holdsPasswords) {
        pushToast(
          `The backup in ${backup.displayName} holds the controller's passwords in plain text; keep it private.`,
          'warning',
        );
      }
      if (!jobAwareConfirm(setupLaserModePrompt(backup.displayName))) return;
      await writeLaserModeOn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="lf-setup-muted">
        {laserProject
          ? 'KerfDesk saves a backup of the controller settings first, then writes $32=1 and reads it back.'
          : 'Save this setup first: the open project is a CNC project, which never writes laser mode on. Then use Send $32=1 in Job Review.'}
      </p>
      <Button
        variant="primary"
        disabled={!laserProject || busy || operationBusy}
        onClick={() => void turnOn()}
      >
        {busy ? 'Turning on laser mode…' : 'Turn on laser mode ($32=1)'}
      </Button>
    </>
  );
}
