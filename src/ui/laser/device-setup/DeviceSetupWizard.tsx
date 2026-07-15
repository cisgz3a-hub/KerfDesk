// Unified Machine Setup dialog. Every step edits a local DeviceProfile +
// MachineConfig draft and the final action commits both atomically.

import { useEffect, useReducer, useState } from 'react';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { LASER_MACHINE_CONFIG, assertNever } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';
import {
  canAdvanceDeviceSetup,
  deviceSetupReducer,
  deviceSetupStepOrder,
  initDeviceSetup,
  isFirstDeviceSetupStep,
  isLastDeviceSetupStep,
  machineSetupProfile,
  machineSetupValidationIssues,
  type DeviceSetupAction,
  type DeviceSetupState,
  type DeviceSetupStep,
} from './device-setup-flow';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { DeviceSetupMachineStep } from './DeviceSetupMachineStep';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';
import { DeviceSetupSafetyStep } from './DeviceSetupSafetyStep';

const STEP_TITLES: Record<DeviceSetupStep, string> = {
  identify: 'Machine & controller',
  connect: 'Connect & read',
  confirm: 'Work area & coordinates',
  machine: 'Machine output',
  safety: 'Safety & calibration',
  firmware: 'Firmware review',
  review: 'Review & hardware handoff',
};

type DeviceSetupWizardProps = {
  readonly onClose: () => void;
  readonly onConfigured?: (profile: DeviceProfile) => void;
};

export function DeviceSetupWizard(props: DeviceSetupWizardProps): JSX.Element {
  const project = useStore((s) => s.project);
  const cachedCncMachine = useStore((s) => s.cachedCncMachine);
  const replaceMachineSetup = useStore((s) => s.replaceMachineSetup);
  const detected = useLaserStore((s) => s.detectedSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const [state, dispatch] = useReducer(deviceSetupReducer, project.device, (seed) =>
    initDeviceSetup(seed, detected, {
      detectedControllerKind,
      controllerRead: lastReadAt !== null,
      machine: project.machine ?? LASER_MACHINE_CONFIG,
      ...(cachedCncMachine === null ? {} : { fallbackCncMachine: cachedCncMachine }),
    }),
  );
  useDetectedSetupSync(dispatch, detected, detectedControllerKind, {
    controllerRead: lastReadAt !== null,
    connected: connectionKind === 'connected',
  });
  const save = useMachineSetupSave(state, props, replaceMachineSetup);
  return (
    <Dialog title="Machine Setup" size="xl" onClose={save.saving ? () => undefined : props.onClose}>
      <SetupLayout state={state} dispatch={dispatch} />
      <SetupActions
        state={state}
        dispatch={dispatch}
        onClose={props.onClose}
        onSave={save.onSave}
        saving={save.saving}
        firmwareWriteCount={save.firmwareWriteCount}
      />
    </Dialog>
  );
}

function useDetectedSetupSync(
  dispatch: React.Dispatch<DeviceSetupAction>,
  detected: Partial<DeviceProfile> | null,
  detectedControllerKind: ControllerKind | null,
  syncState: { readonly controllerRead: boolean; readonly connected: boolean },
): void {
  const { connected, controllerRead } = syncState;
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

function useMachineSetupSave(
  state: DeviceSetupState,
  props: DeviceSetupWizardProps,
  replaceMachineSetup: ReturnType<typeof useStore.getState>['replaceMachineSetup'],
): { readonly saving: boolean; readonly firmwareWriteCount: number; readonly onSave: () => void } {
  const [saving, setSaving] = useState(false);
  const rows = useLaserStore((s) => s.grblSettingsRows);
  const writeGrblSetting = useLaserStore((s) => s.writeGrblSetting);
  const pushToast = useToastStore((s) => s.pushToast);
  const writes = queuedFirmwareDiffs(state, rows);
  const onSave = (): void => {
    if (saving) return;
    setSaving(true);
    void saveAndSync().catch((error: unknown) => {
      pushToast(`Machine Setup could not save: ${errorMessage(error)}`, 'error');
      setSaving(false);
    });
  };
  const saveAndSync = async (): Promise<void> => {
    const profile = machineSetupProfile(state);
    replaceMachineSetup(profile, state.draftMachine, state.cncDraft);
    props.onConfigured?.(profile);
    try {
      for (const write of writes) await writeGrblSetting(write.id, write.desired);
      if (writes.length > 0) {
        pushToast(
          `Firmware sync complete: ${writes.map((write) => write.code).join(', ')} exactly verified.`,
          'success',
        );
      }
    } catch (error: unknown) {
      pushToast(
        `Software setup was saved, but firmware sync stopped: ${errorMessage(error)} Reopen Machine Setup after checking the controller.`,
        'error',
      );
    }
    props.onClose();
  };
  return { saving, firmwareWriteCount: writes.length, onSave };
}

function queuedFirmwareDiffs(
  state: DeviceSetupState,
  rows: ReturnType<typeof useLaserStore.getState>['grblSettingsRows'],
): ReadonlyArray<FirmwareDiff> {
  return computeFirmwareDiffs(state.draft, rows, state.draftMachine).filter(
    (diff) => diff.differs && diff.writable && state.queuedFirmwareWriteIds.includes(diff.id),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function SetupLayout(props: {
  readonly state: DeviceSetupState;
  readonly dispatch: React.Dispatch<DeviceSetupAction>;
}): JSX.Element {
  const stepOrder = deviceSetupStepOrder(props.state.machineKind);
  const stepNumber = stepOrder.indexOf(props.state.step) + 1;
  return (
    <div className="lf-machine-setup-layout" style={layoutStyle}>
      <SetupStepper state={props.state} stepOrder={stepOrder} dispatch={props.dispatch} />
      <div style={contentStyle}>
        <p style={stepHintStyle}>
          Step {stepNumber} of {stepOrder.length} — {STEP_TITLES[props.state.step]}
        </p>
        <div style={bodyStyle}>{renderStep(props.state, props.dispatch)}</div>
      </div>
    </div>
  );
}

function SetupStepper(props: {
  readonly state: DeviceSetupState;
  readonly stepOrder: ReadonlyArray<DeviceSetupStep>;
  readonly dispatch: React.Dispatch<DeviceSetupAction>;
}): JSX.Element {
  return (
    <nav className="lf-machine-setup-stepper" aria-label="Machine Setup steps" style={stepperStyle}>
      {props.stepOrder.map((step, index) => (
        <button
          key={step}
          type="button"
          onClick={() => props.dispatch({ kind: 'go', step })}
          aria-current={step === props.state.step ? 'step' : undefined}
          aria-label={`Go to step ${index + 1}: ${STEP_TITLES[step]}`}
          title={`Open ${STEP_TITLES[step]}`}
          style={{ ...stepStyle, ...(step === props.state.step ? activeStepStyle : {}) }}
        >
          <span style={stepNumberStyle}>{index + 1}</span>
          <span>{STEP_TITLES[step]}</span>
        </button>
      ))}
    </nav>
  );
}

function SetupActions(props: {
  readonly state: DeviceSetupState;
  readonly dispatch: React.Dispatch<DeviceSetupAction>;
  readonly onClose: () => void;
  readonly onSave: () => void;
  readonly saving: boolean;
  readonly firmwareWriteCount: number;
}): JSX.Element {
  const finalStep = isLastDeviceSetupStep(props.state.step, props.state.machineKind);
  const ready = machineSetupValidationIssues(props.state).length === 0;
  return (
    <DialogActions>
      <Button
        onClick={props.onClose}
        disabled={props.saving}
        {...helpProps('control:laser.device-setup.cancel')}
      >
        Cancel without saving
      </Button>
      <Button
        onClick={() => props.dispatch({ kind: 'back' })}
        disabled={props.saving || isFirstDeviceSetupStep(props.state.step, props.state.machineKind)}
        {...helpProps('control:laser.device-setup.back')}
      >
        Back
      </Button>
      {finalStep ? (
        <Button
          variant="primary"
          onClick={props.onSave}
          disabled={!ready || props.saving}
          {...helpProps(
            'control:laser.device-setup.finish',
            ready ? undefined : 'Resolve the flagged software configuration items before saving.',
          )}
        >
          {saveButtonLabel(props.saving, props.firmwareWriteCount)}
        </Button>
      ) : (
        <Button
          variant="primary"
          onClick={() => props.dispatch({ kind: 'next' })}
          disabled={!canAdvanceDeviceSetup(props.state)}
          {...helpProps('control:laser.device-setup.next')}
        >
          Next
        </Button>
      )}
    </DialogActions>
  );
}

function saveButtonLabel(saving: boolean, firmwareWriteCount: number): string {
  if (saving) return 'Saving and verifying…';
  if (firmwareWriteCount === 0) return 'Save machine setup';
  return `Save setup and write ${firmwareWriteCount} setting${firmwareWriteCount === 1 ? '' : 's'}`;
}

function renderStep(
  state: DeviceSetupState,
  dispatch: React.Dispatch<DeviceSetupAction>,
): JSX.Element {
  switch (state.step) {
    case 'identify':
      return <DeviceSetupIdentifyStep state={state} dispatch={dispatch} />;
    case 'connect':
      return <DeviceSetupConnectStep state={state} dispatch={dispatch} />;
    case 'confirm':
      return <DeviceSetupConfirmStep state={state} dispatch={dispatch} />;
    case 'machine':
      return <DeviceSetupMachineStep state={state} dispatch={dispatch} />;
    case 'safety':
      return <DeviceSetupSafetyStep state={state} dispatch={dispatch} />;
    case 'firmware':
      return <DeviceSetupFirmwareStep state={state} dispatch={dispatch} />;
    case 'review':
      return <DeviceSetupReviewStep state={state} dispatch={dispatch} />;
    default:
      return assertNever(state.step);
  }
}

const stepHintStyle: React.CSSProperties = {
  margin: '0 0 8px',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--lf-text-muted)',
};
const layoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '190px minmax(0, 1fr)',
  gap: 16,
  minHeight: 520,
};
const stepperStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  borderRight: '1px solid var(--lf-border)',
  paddingRight: 12,
};
const stepStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '24px minmax(0, 1fr)',
  gap: 7,
  alignItems: 'center',
  padding: '7px 6px',
  borderRadius: 5,
  border: 0,
  width: '100%',
  background: 'transparent',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  fontFamily: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};
const activeStepStyle: React.CSSProperties = {
  background: 'var(--lf-bg-2)',
  color: 'var(--lf-text)',
  fontWeight: 600,
};
const stepNumberStyle: React.CSSProperties = {
  display: 'grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  border: '1px solid var(--lf-border)',
  borderRadius: '50%',
  fontSize: 11,
};
const contentStyle: React.CSSProperties = { minWidth: 0, overflow: 'hidden' };
const bodyStyle: React.CSSProperties = {
  minHeight: 440,
  maxHeight: 560,
  overflowY: 'auto',
  paddingRight: 6,
};
