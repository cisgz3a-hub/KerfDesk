// DeviceSetupWizard — the connect-time guided setup surface (ADR-092). A
// manually-launched, multi-step Dialog that keeps an exact profile draft plus
// a separate controller $$ observation, walks the operator through confirming
// explicit changes, and commits only on Finish.
// The step logic is the pure reducer in device-setup-flow.ts; this file is the
// shell + footer navigation.

import { useEffect, useReducer } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { assertNever, machineKindOf, type MachineConfig } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button, Dialog, DialogActions } from '../../kit';
import { computeCncDetectedApply } from '../../machine/cnc-detected-apply';
import { useStore } from '../../state';
import type { CncMachineSetupPatch } from '../../state/machine-actions';
import { useLaserStore } from '../../state/laser-store';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import {
  canAdvanceDeviceSetup,
  deviceSetupStepOrder,
  deviceSetupReducer,
  initDeviceSetup,
  isFirstDeviceSetupStep,
  isLastDeviceSetupStep,
  type DeviceSetupAction,
  type DeviceSetupState,
  type DeviceSetupStep,
} from './device-setup-flow';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { DeviceSetupProbeStep } from './DeviceSetupProbeStep';
import { computeSetupReadiness } from './device-setup-readiness';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';
import { DeviceSetupSafetyStep } from './DeviceSetupSafetyStep';

const STEP_TITLES: Record<DeviceSetupStep, string> = {
  connect: 'Connect & read',
  identify: 'Identify machine',
  confirm: 'Confirm settings',
  safety: 'Homing & options',
  probe: 'Set work zero (probe)',
  firmware: 'Sync to controller',
  review: 'Review & finish',
};

export function DeviceSetupWizard(props: {
  readonly onClose: () => void;
  readonly onConfigured?: (profile: DeviceProfile) => void;
}): JSX.Element {
  const device = useStore((s) => s.project.device);
  const machineKind = useStore((s) => machineKindOf(s.project.machine));
  const machine = useStore((s) => s.project.machine);
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const applyCncMachineSetup = useStore((s) => s.applyCncMachineSetup);
  const detected = useLaserStore((s) => s.detectedSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const [state, dispatch] = useReducer(deviceSetupReducer, device, (seed) =>
    initDeviceSetup(seed, detected, {
      detectedControllerKind,
      controllerRead: lastReadAt !== null,
      machineKind,
    }),
  );
  useDetectedSetupSync(
    dispatch,
    detected,
    detectedControllerKind,
    lastReadAt !== null,
    connectionKind === 'connected',
  );
  // Readiness scores against state.detected (kept in sync by the effect above),
  // so the footer's Finish gate matches the committed draft.
  const ready = computeSetupReadiness(state.draft, state.detected, state.machineKind).ready;
  const stepOrder = deviceSetupStepOrder(state.machineKind);
  const stepNumber = stepOrder.indexOf(state.step) + 1;
  const onFinish = (): void => {
    commitDeviceSetup(state, machine, replaceDeviceProfile, applyCncMachineSetup);
    props.onConfigured?.(state.draft);
    props.onClose();
  };
  return (
    <Dialog title="Device Setup" size="lg" onClose={props.onClose}>
      <p style={stepHintStyle}>
        Step {stepNumber} of {stepOrder.length} — {STEP_TITLES[state.step]}
      </p>
      <div style={bodyStyle}>{renderStep(state, dispatch)}</div>
      <DialogActions>
        <Button onClick={props.onClose} {...helpProps('control:laser.device-setup.cancel')}>
          Cancel
        </Button>
        <Button
          onClick={() => dispatch({ kind: 'back' })}
          disabled={isFirstDeviceSetupStep(state.step, state.machineKind)}
          {...helpProps('control:laser.device-setup.back')}
        >
          Back
        </Button>
        {isLastDeviceSetupStep(state.step, state.machineKind) ? (
          <Button
            variant="primary"
            onClick={onFinish}
            disabled={!ready}
            {...helpProps(
              'control:laser.device-setup.finish',
              ready ? undefined : 'Resolve the flagged items before finishing.',
            )}
          >
            Finish setup
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => dispatch({ kind: 'next' })}
            disabled={!canAdvanceDeviceSetup(state)}
            {...helpProps('control:laser.device-setup.next')}
          >
            Next
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

function useDetectedSetupSync(
  dispatch: React.Dispatch<DeviceSetupAction>,
  detected: Partial<DeviceProfile> | null,
  detectedControllerKind: DeviceProfile['controllerKind'] | null,
  controllerRead: boolean,
  connected: boolean,
): void {
  // Preserve the last read during the transient null before a re-read reply,
  // but clear it once the controller session is actually gone.
  useEffect(() => {
    dispatch({
      kind: 'detected-updated',
      ...(detected === null ? (connected ? {} : { detected: {} }) : { detected }),
      detectedControllerKind,
      ...(controllerRead ? { controllerRead: true } : connected ? {} : { controllerRead: false }),
    });
  }, [connected, controllerRead, detected, detectedControllerKind, dispatch]);
}

function commitDeviceSetup(
  state: DeviceSetupState,
  machine: MachineConfig | null | undefined,
  replaceDeviceProfile: (profile: DeviceProfile) => void,
  applyCncMachineSetup: (patch: CncMachineSetupPatch) => void,
): void {
  if (machine?.kind !== 'cnc') {
    replaceDeviceProfile(state.draft);
    return;
  }
  const detectedApply = state.detectedAccepted
    ? computeCncDetectedApply(state.detected, machine, state.draft)
    : null;
  applyCncMachineSetup({
    deviceProfile: state.draft,
    ...(detectedApply === null
      ? {}
      : { paramsPatch: detectedApply.paramsPatch, devicePatch: detectedApply.devicePatch }),
  });
}

function renderStep(
  state: DeviceSetupState,
  dispatch: React.Dispatch<DeviceSetupAction>,
): JSX.Element {
  switch (state.step) {
    case 'connect':
      return <DeviceSetupConnectStep state={state} dispatch={dispatch} />;
    case 'identify':
      return <DeviceSetupIdentifyStep state={state} dispatch={dispatch} />;
    case 'confirm':
      return <DeviceSetupConfirmStep state={state} dispatch={dispatch} />;
    case 'safety':
      return <DeviceSetupSafetyStep state={state} dispatch={dispatch} />;
    case 'probe':
      return <DeviceSetupProbeStep />;
    case 'firmware':
      return <DeviceSetupFirmwareStep state={state} />;
    case 'review':
      return <DeviceSetupReviewStep state={state} dispatch={dispatch} />;
    default:
      return assertNever(state.step);
  }
}

const stepHintStyle: React.CSSProperties = {
  margin: '0 0 8px 0',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--lf-text-muted)',
};
const bodyStyle: React.CSSProperties = { minHeight: 220 };
