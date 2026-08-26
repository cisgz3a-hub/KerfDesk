import { useState } from 'react';
import type { DeviceProfile } from '../../../core/devices';
import type { CncTool } from '../../../core/scene';
import { cncRetainedFeedAdvisoriesAfterSetupChange } from '../../common/cnc-bit-change-advisory';
import { blockedMachineModeMessage } from '../../machine/machine-capability-messages';
import { useStore } from '../../state';
import type { CncStartupOperationDraft } from '../../state/cnc-startup-setup';
import { useLaserStore } from '../../state/laser-store';
import { useToastStore } from '../../state/toast-store';
import type { DeviceSetupState } from './device-setup-flow';
import { machineSetupProfile } from './device-setup-flow';
import { computeFirmwareDiffs, type FirmwareDiff } from './device-setup-firmware-diff';

export function useMachineSetupSave(input: {
  readonly state: DeviceSetupState;
  readonly operationDrafts: ReadonlyArray<CncStartupOperationDraft>;
  readonly customTools: ReadonlyArray<CncTool>;
  readonly materialApplyRequested: boolean;
  readonly onClose: () => void;
  readonly onConfigured?: ((profile: DeviceProfile) => void) | undefined;
}): { readonly saving: boolean; readonly firmwareWriteCount: number; readonly onSave: () => void } {
  const [saving, setSaving] = useState(false);
  const replaceMachineSetup = useStore((store) => store.replaceMachineSetup);
  const replaceCncStartupSetup = useStore((store) => store.replaceCncStartupSetup);
  const rows = useLaserStore((store) => store.grblSettingsRows);
  const writeGrblSetting = useLaserStore((store) => store.writeGrblSetting);
  const pushToast = useToastStore((store) => store.pushToast);
  const writes = queuedFirmwareDiffs(input.state, rows);
  const onSave = (): void => {
    if (saving) return;
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
            operationDrafts: input.operationDrafts,
            customTools: input.customTools,
            materialApplyRequested: input.materialApplyRequested,
          })
        : replaceMachineSetup(profile, input.state.draftMachine, input.state.cncDraft);
    if (replacement.kind === 'blocked-by-capability') {
      throw new Error(blockedMachineModeMessage(replacement.requestedKind));
    }
    for (const advisory of cncRetainedFeedAdvisoriesAfterSetupChange(
      before,
      useStore.getState().project,
    )) {
      pushToast(advisory, 'warning');
    }
    input.onConfigured?.(profile);
    await syncFirmware(writes, writeGrblSetting, pushToast);
    input.onClose();
  };
  return { saving, firmwareWriteCount: writes.length, onSave };
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
