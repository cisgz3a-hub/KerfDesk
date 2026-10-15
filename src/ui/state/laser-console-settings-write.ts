import type { ControllerDriver } from '../../core/controllers';
import type { PreparedConsoleCommand } from '../../core/controllers/grbl';
import { beginReportUnitsWrite } from './controller-report-units';
import { grblSettingWriteEvidencePatch } from './grbl-settings-evidence';
import { failedControllerQualificationPatch } from './laser-controller-qualification';
import {
  EMPTY_SETTINGS_RESPONSE_MESSAGE,
  reportUnitsStayUnconfirmed,
  settingWriteStaysUnverified,
} from './laser-console-completion';
import type { LaserState } from './laser-store';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

export function beginConsoleSettingWriteEvidence(
  set: SetFn,
  get: GetFn,
  driver: ControllerDriver,
  command: PreparedConsoleCommand,
) {
  const reportUnitsWrite = /^\$0*13\s*=/.test(command.normalized);
  const numericSetting =
    command.kind === 'setting-write' ? /^\$(\d+)=(.*)$/.exec(command.normalized) : null;
  const qualificationEpoch = get().controllerSessionEpoch;
  if (numericSetting !== null) {
    set(
      grblSettingWriteEvidencePatch(
        get(),
        driver,
        Number(numericSetting[1]),
        numericSetting[2] ?? '',
      ),
    );
  } else if (reportUnitsWrite) set(beginReportUnitsWrite());
  return {
    numeric: numericSetting !== null,
    reportUnitsWrite,
    qualificationEpoch,
    requalifiesSettings:
      numericSetting !== null && (driver.commands.settingsQuery !== null || reportUnitsWrite),
  };
}

// The controller's dump establishes what a setting write actually stored
// (ADR-375, C-4). A $13 write also keeps position hidden until report units
// are confirmed. The Falcon no-dump command contract remains unchanged.
export async function rereadSettingsAfterConsoleWrite(
  set: SetFn,
  get: GetFn,
  driver: ControllerDriver,
  written: string,
  reportUnitsWrite: boolean,
  dispatchRead: (command: PreparedConsoleCommand) => Promise<void>,
): Promise<void> {
  const query = driver.commands.settingsQuery ?? (reportUnitsWrite ? '$$' : null);
  if (query === null) return;
  const qualificationEpoch = get().controllerSessionEpoch;
  const settingsRead = driver.prepareConsoleCommand(query);
  try {
    if (!settingsRead.ok) throw new Error(settingsRead.reason);
    await dispatchRead(settingsRead.command);
    const qualification = get().controllerQualification;
    if (qualification.kind === 'qualifying' && qualification.epoch === qualificationEpoch) {
      set((state) =>
        failedControllerQualificationPatch(
          state,
          qualificationEpoch,
          EMPTY_SETTINGS_RESPONSE_MESSAGE,
        ),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set((state) => failedControllerQualificationPatch(state, qualificationEpoch, message));
    if (reportUnitsWrite) reportUnitsStayUnconfirmed(set, error);
    else settingWriteStaysUnverified(set, written, error);
  }
}
