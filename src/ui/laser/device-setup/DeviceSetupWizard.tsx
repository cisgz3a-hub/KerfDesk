// One draft across Machine, Essentials and Review. Existing recovery targets
// open the relevant section, and only Save changes the project.
import { useEffect, useReducer, useState } from 'react';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { LASER_MACHINE_CONFIG, type MachineKind } from '../../../core/scene';
import { Dialog } from '../../kit';
import { useStore } from '../../state';
import { cncMachineWithCustomTools } from '../../state/machine-actions';
import { useLaserStore } from '../../state/laser-store';
import {
  browserLocalStorage,
  loadConfiguredSignatures,
} from '../../state/device-setup-configured-persistence';
import { deviceProfileSignature } from './device-setup-nudge';
import { useControllerAutoFill } from './use-controller-auto-fill';
import {
  deviceSetupReducer,
  initDeviceSetup,
  type DeviceSetupAction,
  type DeviceSetupStep,
} from './device-setup-flow';
import { useCncStartupWizardDraft } from './cnc-startup-wizard-draft';
import type { DeviceSetupHighlight, MachineSetupTarget } from './machine-setup-dialog-store';
import { useMachineSetupSave } from './use-machine-setup-save';
import { useMachineSetupTargetFocus } from './use-machine-setup-target-focus';
import { DeviceSetupShell } from './DeviceSetupShell';
import './device-setup.css';

const MACHINE_KINDS: ReadonlyArray<MachineKind> = ['laser', 'cnc'];

type DeviceSetupWizardProps = {
  readonly onClose: () => void;
  readonly onConfigured?: (profile: DeviceProfile) => void;
  readonly initialStep?: DeviceSetupStep;
  readonly highlight?: DeviceSetupHighlight | undefined;
  readonly target?: MachineSetupTarget | undefined;
};

export function DeviceSetupWizard(props: DeviceSetupWizardProps): JSX.Element {
  const documentEpoch = useStore((s) => s.projectDocumentEpoch);
  // A replacement document owns a new draft, even when its device is identical.
  return <DeviceSetupWizardDraft key={documentEpoch} {...props} />;
}

function DeviceSetupWizardDraft(props: DeviceSetupWizardProps): JSX.Element {
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
        : { fallbackCncMachine: cncMachineWithCustomTools(cachedCncMachine, libraryCustomTools) }),
    });
    return props.initialStep === undefined ? initial : { ...initial, step: props.initialStep };
  });
  useDetectedSetupSync(dispatch, detected, detectedControllerKind, {
    controllerRead: lastReadAt !== null,
    connected: connectionKind === 'connected',
  });
  // A machine that has not been through setup fills in what its controller
  // reports by itself (ADR-420). Decided once, when setup opens. Setup saved
  // for either head counts (ADR-416 records them apart).
  const [newMachine] = useState(() => {
    const storage = browserLocalStorage();
    const configured = storage === null ? new Set<string>() : loadConfiguredSignatures(storage);
    return !MACHINE_KINDS.some((kind) =>
      configured.has(deviceProfileSignature(project.device, kind)),
    );
  });
  const automatic = useControllerAutoFill(state, dispatch, newMachine);
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
  return (
    <Dialog
      title={state.machineKind === 'cnc' ? 'CNC Machine Setup' : 'Machine Setup'}
      size="xl"
      panelClassName="lf-setup-dialog"
      onClose={save.saving ? () => undefined : props.onClose}
    >
      <DeviceSetupShell
        state={state}
        dispatch={dispatch}
        highlight={props.highlight}
        layers={project.scene.layers}
        cncSetup={cncSetup}
        automatic={automatic}
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
  useEffect(() => {
    dispatch({
      kind: 'detected-updated',
      ...(detected === null ? (connected ? {} : { detected: {} }) : { detected }),
      detectedControllerKind,
      ...(controllerRead ? { controllerRead: true } : connected ? {} : { controllerRead: false }),
    });
  }, [connected, controllerRead, detected, detectedControllerKind, dispatch]);
}
