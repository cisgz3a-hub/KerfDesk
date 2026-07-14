// DeviceSetupWizard — the connect-time guided setup surface (ADR-092). A
// manually-launched, multi-step Dialog that seeds a draft DeviceProfile from
// the active profile + the controller's $$ readback, walks the operator
// through confirming it, and commits via replaceDeviceProfile only on Finish.
// The step logic is the pure reducer in device-setup-flow.ts; this file is the
// shell + footer navigation.

import { useEffect, useReducer } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import { assertNever, machineKindOf } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
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
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const detected = useLaserStore((s) => s.detectedSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const [state, dispatch] = useReducer(deviceSetupReducer, device, (seed) =>
    initDeviceSetup(seed, detected, {
      detectedControllerKind,
      controllerRead: lastReadAt !== null,
      machineKind,
    }),
  );
  // Keep the reducer's detected value in sync with the live controller read, so
  // apply-preset and the readiness gate use current $$ values even when the
  // operator connects or re-reads after the wizard opened (audit fix B). Skip the
  // transient null a re-read sets before its reply lands, so the last-known
  // detection survives the window instead of briefly emptying.
  useEffect(() => {
    if (detected !== null) {
      dispatch({
        kind: 'detected-updated',
        detected,
        detectedControllerKind,
        controllerRead: lastReadAt !== null,
      });
    }
  }, [detected, detectedControllerKind, lastReadAt]);
  // Readiness scores against state.detected (kept in sync by the effect above),
  // so the footer's Finish gate matches the committed draft.
  const ready = computeSetupReadiness(state.draft, state.detected).ready;
  const stepOrder = deviceSetupStepOrder(state.machineKind);
  const stepNumber = stepOrder.indexOf(state.step) + 1;
  const onFinish = (): void => {
    replaceDeviceProfile(state.draft);
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
