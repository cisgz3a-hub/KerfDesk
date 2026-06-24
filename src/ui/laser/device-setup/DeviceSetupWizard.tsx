// DeviceSetupWizard — the connect-time guided setup surface (ADR-092). A
// manually-launched, multi-step Dialog that seeds a draft DeviceProfile from
// the active profile + the controller's $$ readback, walks the operator
// through confirming it, and commits via replaceDeviceProfile only on Finish.
// The step logic is the pure reducer in device-setup-flow.ts; this file is the
// shell + footer navigation.

import { useReducer } from 'react';
import { assertNever } from '../../../core/scene';
import { useRegisterModal } from '../../common/use-register-modal';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import {
  canAdvanceDeviceSetup,
  DEVICE_SETUP_STEP_ORDER,
  deviceSetupReducer,
  initDeviceSetup,
  isFirstDeviceSetupStep,
  isLastDeviceSetupStep,
  type DeviceSetupAction,
  type DeviceSetupState,
  type DeviceSetupStep,
} from './device-setup-flow';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { computeSetupReadiness } from './device-setup-readiness';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';
import { DeviceSetupSafetyStep } from './DeviceSetupSafetyStep';

const STEP_TITLES: Record<DeviceSetupStep, string> = {
  connect: 'Connect & read',
  identify: 'Identify machine',
  confirm: 'Confirm settings',
  safety: 'Homing & options',
  firmware: 'Sync to controller',
  review: 'Review & finish',
};

export function DeviceSetupWizard(props: { readonly onClose: () => void }): JSX.Element {
  useRegisterModal();
  const device = useStore((s) => s.project.device);
  const replaceDeviceProfile = useStore((s) => s.replaceDeviceProfile);
  const detected = useLaserStore((s) => s.detectedSettings);
  const [state, dispatch] = useReducer(deviceSetupReducer, device, (seed) =>
    initDeviceSetup(seed, detected),
  );
  // Readiness scores against state.detected (the snapshot seeded into the draft),
  // not the live store, so the footer's Finish gate matches the committed draft.
  const ready = computeSetupReadiness(state.draft, state.detected).ready;
  const stepNumber = DEVICE_SETUP_STEP_ORDER.indexOf(state.step) + 1;
  const onFinish = (): void => {
    replaceDeviceProfile(state.draft);
    props.onClose();
  };
  return (
    <Dialog title="Set up device" size="lg" onClose={props.onClose}>
      <p style={stepHintStyle}>
        Step {stepNumber} of {DEVICE_SETUP_STEP_ORDER.length} — {STEP_TITLES[state.step]}
      </p>
      <div style={bodyStyle}>{renderStep(state, dispatch)}</div>
      <DialogActions>
        <Button onClick={props.onClose} title="Discard this setup and close.">
          Cancel
        </Button>
        <Button
          onClick={() => dispatch({ kind: 'back' })}
          disabled={isFirstDeviceSetupStep(state.step)}
          title="Go to the previous step."
        >
          Back
        </Button>
        {isLastDeviceSetupStep(state.step) ? (
          <Button
            variant="primary"
            onClick={onFinish}
            disabled={!ready}
            title={ready ? 'Save this profile.' : 'Resolve the flagged items before finishing.'}
          >
            Finish setup
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => dispatch({ kind: 'next' })}
            disabled={!canAdvanceDeviceSetup(state)}
            title="Go to the next step."
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
    case 'firmware':
      return <DeviceSetupFirmwareStep state={state} />;
    case 'review':
      return <DeviceSetupReviewStep state={state} />;
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
