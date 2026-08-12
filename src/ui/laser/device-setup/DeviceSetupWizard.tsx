// Unified Machine Setup dialog. Every step edits a local DeviceProfile +
// MachineConfig draft and the final action commits both atomically.

import { useEffect, useReducer } from 'react';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { LASER_MACHINE_CONFIG, assertNever } from '../../../core/scene';
import { helpProps } from '../../help/help-topics';
import { Button, Dialog, DialogActions } from '../../kit';
import { useStore } from '../../state';
import { cncMachineWithCustomTools } from '../../state/machine-actions';
import { useLaserStore } from '../../state/laser-store';
import { DeviceSetupConfirmStep } from './DeviceSetupConfirmStep';
import { DeviceSetupConnectStep } from './DeviceSetupConnectStep';
import { DeviceSetupFirmwareStep } from './DeviceSetupFirmwareStep';
import {
  canAdvanceDeviceSetup,
  deviceSetupReducer,
  deviceSetupStepOrder,
  initDeviceSetup,
  isFirstDeviceSetupStep,
  isLastDeviceSetupStep,
  machineSetupValidationIssues,
  type DeviceSetupAction,
  type DeviceSetupState,
  type DeviceSetupStep,
} from './device-setup-flow';
import { DeviceSetupCapabilityStep } from './DeviceSetupCapabilityStep';
import { DeviceSetupCncJobStep } from './DeviceSetupCncJobStep';
import { DeviceSetupCncMachineStep } from './DeviceSetupCncMachineStep';
import { DeviceSetupIdentifyStep } from './DeviceSetupIdentifyStep';
import { DeviceSetupMachineStep } from './DeviceSetupMachineStep';
import { DeviceSetupOptionsStep } from './DeviceSetupOptionsStep';
import { DeviceSetupReviewStep } from './DeviceSetupReviewStep';
import { useCncStartupWizardDraft, type CncStartupWizardDraft } from './cnc-startup-wizard-draft';
import type { DeviceSetupHighlight, MachineSetupTarget } from './machine-setup-dialog-store';
import { useMachineSetupSave } from './use-machine-setup-save';
import { useMachineSetupTargetFocus } from './use-machine-setup-target-focus';

const STEP_TITLES: Record<DeviceSetupStep, string> = {
  capability: 'Machine type',
  identify: 'Choose your machine',
  connect: 'Connect & detect',
  confirm: 'Confirm settings',
  'cnc-setup': 'CNC Startup Setup',
  options: 'Options & calibration',
  review: 'Review & save',
};

type DeviceSetupWizardProps = {
  readonly onClose: () => void;
  readonly onConfigured?: (profile: DeviceProfile) => void;
  readonly initialStep?: DeviceSetupStep;
  readonly highlight?: DeviceSetupHighlight | undefined;
  readonly target?: MachineSetupTarget | undefined;
};

export function DeviceSetupWizard(props: DeviceSetupWizardProps): JSX.Element {
  const project = useStore((s) => s.project);
  const cachedCncMachine = useStore((s) => s.cachedCncMachine);
  const libraryCustomTools = useStore((s) => s.cncLibrary.customTools);
  const detected = useLaserStore((s) => s.detectedSettings);
  const detectedControllerKind = useLaserStore((s) => s.detectedControllerKind);
  const lastReadAt = useLaserStore((s) => s.lastSettingsReadAt);
  const connectionKind = useLaserStore((s) => s.connection.kind);
  const [state, dispatch] = useReducer(deviceSetupReducer, project.device, (seed) => {
    const initial = initDeviceSetup(seed, detected, {
      detectedControllerKind,
      controllerRead: lastReadAt !== null,
      machine:
        project.machine?.kind === 'cnc'
          ? cncMachineWithCustomTools(project.machine, libraryCustomTools)
          : (project.machine ?? LASER_MACHINE_CONFIG),
      ...(cachedCncMachine === null
        ? {}
        : {
            fallbackCncMachine: cncMachineWithCustomTools(cachedCncMachine, libraryCustomTools),
          }),
    });
    return props.initialStep === undefined ? initial : { ...initial, step: props.initialStep };
  });
  useDetectedSetupSync(dispatch, detected, detectedControllerKind, {
    controllerRead: lastReadAt !== null,
    connected: connectionKind === 'connected',
  });
  const cncSetup = useCncStartupWizardDraft(project.scene.layers, libraryCustomTools);
  useMachineSetupTargetFocus(props.target, state.step);
  const save = useMachineSetupSave({
    state,
    operationDrafts: cncSetup.operationDrafts,
    customTools: cncSetup.customTools,
    materialApplyRequested: cncSetup.materialApplyRequested,
    onClose: props.onClose,
    onConfigured: props.onConfigured,
  });
  const dialogTitle = state.machineKind === 'cnc' ? 'CNC Startup Setup' : 'Machine Setup';
  return (
    <Dialog title={dialogTitle} size="xl" onClose={save.saving ? () => undefined : props.onClose}>
      <SetupLayout
        state={state}
        dispatch={dispatch}
        highlight={props.highlight}
        layers={project.scene.layers}
        cncSetup={cncSetup}
      />
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

function SetupLayout(props: {
  readonly state: DeviceSetupState;
  readonly dispatch: React.Dispatch<DeviceSetupAction>;
  readonly highlight?: DeviceSetupHighlight | undefined;
  readonly layers: ReturnType<typeof useStore.getState>['project']['scene']['layers'];
  readonly cncSetup: CncStartupWizardDraft;
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
        <div style={bodyStyle}>
          {renderStep(props.state, props.dispatch, props.layers, props.cncSetup, props.highlight)}
        </div>
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
          {saveButtonLabel(props.saving, props.firmwareWriteCount, props.state.machineKind)}
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

function saveButtonLabel(
  saving: boolean,
  firmwareWriteCount: number,
  machineKind: DeviceSetupState['machineKind'],
): string {
  if (saving) return 'Saving and verifying…';
  if (firmwareWriteCount === 0) {
    return machineKind === 'cnc' ? 'Save CNC startup setup' : 'Save machine setup';
  }
  const setupLabel = machineKind === 'cnc' ? 'CNC startup setup' : 'setup';
  return `Save ${setupLabel} and write ${firmwareWriteCount} setting${firmwareWriteCount === 1 ? '' : 's'}`;
}

// The confirm page stacks the coordinate model and machine output on one
// flat scrollable page, and the review page puts firmware comparison above
// the review cards so Save follows the queued-write summary it executes
// (ADR-240).
function renderStep(
  state: DeviceSetupState,
  dispatch: React.Dispatch<DeviceSetupAction>,
  layers: ReturnType<typeof useStore.getState>['project']['scene']['layers'],
  cncSetup: CncStartupWizardDraft,
  highlight?: DeviceSetupHighlight | undefined,
): JSX.Element {
  switch (state.step) {
    case 'capability':
      return <DeviceSetupCapabilityStep state={state} dispatch={dispatch} />;
    case 'identify':
      return <DeviceSetupIdentifyStep state={state} dispatch={dispatch} />;
    case 'connect':
      return <DeviceSetupConnectStep state={state} dispatch={dispatch} />;
    case 'confirm':
      return (
        <div style={stackedStepStyle}>
          <DeviceSetupConfirmStep state={state} dispatch={dispatch} />
          {state.machineKind === 'cnc' ? null : (
            <DeviceSetupMachineStep state={state} dispatch={dispatch} />
          )}
        </div>
      );
    case 'cnc-setup':
      return (
        <div style={stackedStepStyle}>
          <DeviceSetupCncMachineStep state={state} dispatch={dispatch} machine={state.cncDraft} />
          <DeviceSetupCncJobStep
            state={state}
            dispatch={dispatch}
            layers={layers}
            operationDrafts={cncSetup.operationDrafts}
            customTools={cncSetup.customTools}
            onApplyMaterial={cncSetup.applyMaterial}
            onChangeOperation={cncSetup.changeOperation}
            onChangeCustomTools={cncSetup.changeCustomTools}
            onRemoveTool={cncSetup.removeTool}
          />
        </div>
      );
    case 'options':
      return (
        <DeviceSetupOptionsStep
          state={state}
          dispatch={dispatch}
          openAutofocus={highlight === 'autofocus'}
        />
      );
    case 'review':
      return (
        <div style={stackedStepStyle}>
          <DeviceSetupFirmwareStep state={state} dispatch={dispatch} />
          <DeviceSetupReviewStep
            state={state}
            dispatch={dispatch}
            operationDrafts={cncSetup.operationDrafts}
          />
        </div>
      );
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
const stackedStepStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};
const bodyStyle: React.CSSProperties = {
  minHeight: 440,
  maxHeight: 560,
  overflowY: 'auto',
  paddingRight: 6,
};
