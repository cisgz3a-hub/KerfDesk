import { useState } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import type { CncTool } from '../../../core/scene';
import { cncRetainedFeedAdvisoriesAfterSetupChange } from '../../common/cnc-bit-change-advisory';
import { usePlatformOptional } from '../../app/platform-context';
import { machineCapabilityWarningMessage } from '../../machine/machine-capability-messages';
import { useStore } from '../../state';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';
import { useLaserStore } from '../../state/laser-store';
import { isActiveJobStatus } from '../../state/laser-store-helpers';
import {
  activeLinkMachineWork,
  anyMachineJobActive,
  useLinkMachineWorkStore,
} from '../../state/link-machine-work';
import { useToastStore } from '../../state/toast-store';
import type { DeviceSetupState } from './device-setup-flow';
import { machineSetupProfile } from './device-setup-flow';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';
import { switchDriverAfterSave } from './save-driver-switch';
import { setupConvertedLaserQuestion } from './DeviceSetupConvertedLaser';
import { useConvertedLaserAnswerStore } from '../../state/converted-laser-question';
import { errorMessage } from '../../../core/util/error-message';

// A running or held job keeps the machine it started with, as the toolbar's
// Laser/CNC switch does (ADR-416 Amendment 1). Save replaces the machine type,
// work area, origin, homing and CNC values that jog, Zero Z, probing and the
// safe-Z lift read live during a bit change, so it waits for the job to end.
export const SETUP_SAVE_LOCKED_DURING_JOB =
  'Finish or stop the running job before saving Machine Setup. Nothing was saved; your changes stay in this draft.';

export function useMachineSetupSave(input: {
  readonly state: DeviceSetupState;
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly materialApplyRequested: boolean;
  readonly onClose: () => void;
  readonly onConfigured?: ((profile: DeviceProfile) => void) | undefined;
}): {
  readonly saving: boolean;
  readonly firmwareWriteCount: number;
  /** A job is running or held, so Save is refused until it ends. */
  readonly lockedByJob: boolean;
  readonly onSave: () => void;
} {
  const [saving, setSaving] = useState(false);
  const platform = usePlatformOptional();
  const replaceMachineSetup = useStore((store) => store.replaceMachineSetup);
  const replaceCncStartupSetup = useStore((store) => store.replaceCncStartupSetup);
  const rows = useLaserStore((store) => store.grblSettingsRows);
  const writeGrblSetting = useLaserStore((store) => store.writeGrblSetting);
  const laserJob = useLaserStore((store) => isActiveJobStatus(store.streamer?.status ?? null));
  // A Moshi or Ruida link job too: a profile change would unmount its Abort.
  const linkJob = useLinkMachineWorkStore((store) => activeLinkMachineWork(store) !== null);
  const lockedByJob = laserJob || linkJob;
  const pushToast = useToastStore((store) => store.pushToast);
  const writes = queuedFirmwareDiffs(input.state, rows);
  const onSave = (): void => {
    if (saving) return;
    if (anyMachineJobActive()) {
      pushToast(SETUP_SAVE_LOCKED_DURING_JOB, 'warning');
      return;
    }
    setSaving(true);
    void saveAndSync().catch((error: unknown) => {
      pushToast(`Machine Setup could not save: ${errorMessage(error)}`, 'error');
      setSaving(false);
    });
  };
  const saveAndSync = async (): Promise<void> => {
    const before = useStore.getState().project;
    const profile = machineSetupProfile(input.state);
    const replacement =
      input.state.draftMachine.kind === 'cnc'
        ? replaceCncStartupSetup(profile, input.state.draftMachine, input.state.cncDraft, {
            cncSetup: input.state.cncSetupDraft,
            operationDrafts: input.operationDrafts,
            customTools: input.customTools,
            materialApplyRequested: input.materialApplyRequested,
          })
        : replaceMachineSetup(
            profile,
            input.state.draftMachine,
            input.state.cncDraft,
            input.state.cncSetupDraft,
          );
    if (replacement.kind === 'applied-with-capability-warning') {
      pushToast(machineCapabilityWarningMessage(replacement.requestedKind), 'warning');
    }
    for (const advisory of cncRetainedFeedAdvisoriesAfterSetupChange(
      before,
      useStore.getState().project,
    )) {
      pushToast(advisory, 'warning');
    }
    keepRouterAnswer(input.state);
    input.onConfigured?.(profile);
    await syncFirmware(writes, writeGrblSetting, pushToast);
    input.onClose();
    // The firmware writes went out on the connection their rows were read
    // from; the saved profile's driver takes over after them (U2-P2-1).
    await switchDriverAfterSave(platform);
  };
  return { saving, firmwareWriteCount: writes.length, lockedByJob, onSave };
}

// A CNC saved here is the operator's own choice (ADR-637 Amendment 7), so a
// starter set up as a router is not asked whether it is a laser later. A CNC
// Setup opened on while 1.0.29's question is still open is not an answer:
// Save alone keeps that question (Amendment 8).
function keepRouterAnswer(state: DeviceSetupState): void {
  if (state.draftMachine.kind !== 'cnc') return;
  if (setupConvertedLaserQuestion(state, useLaserStore.getState()) !== null) return;
  useConvertedLaserAnswerStore.getState().answerRouter();
}

async function syncFirmware(
  writes: ReadonlyArray<FirmwareDiff>,
  writeGrblSetting: ReturnType<typeof useLaserStore.getState>['writeGrblSetting'],
  pushToast: ReturnType<typeof useToastStore.getState>['pushToast'],
): Promise<void> {
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
}

function queuedFirmwareDiffs(
  state: DeviceSetupState,
  rows: ReturnType<typeof useLaserStore.getState>['grblSettingsRows'],
): ReadonlyArray<FirmwareDiff> {
  return computeFirmwareDiffs(state.draft, rows, {
    machine: state.draftMachine,
    machineKinds: state.machineKinds,
  }).filter(
    (diff) => diff.differs && diff.writable && state.queuedFirmwareWriteIds.includes(diff.id),
  );
}
