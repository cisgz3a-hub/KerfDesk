import type { ControllerDriver } from '../../core/controllers';
import { consoleSettingReadbackIssue } from '../../core/controllers/console-setting-writes';
import type { PreparedConsoleCommand } from '../../core/controllers/grbl';
import {
  gcodeReportUnitsStayUnconfirmed,
  lineLeavesOtherReportUnits,
  rereadReportUnitsAfterConsoleLine,
} from './console-report-units';
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
  // Smoothieware's reports follow G20/G21 instead (console-report-units.ts).
  const gcodeReportUnits = lineLeavesOtherReportUnits(driver, command.normalized, get());
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
  } else if (reportUnitsWrite || gcodeReportUnits) set(beginReportUnitsWrite());
  return {
    numeric: numericSetting !== null,
    reportUnitsWrite,
    gcodeReportUnits,
    qualificationEpoch,
    requalifiesSettings:
      numericSetting !== null && (driver.commands.settingsQuery !== null || reportUnitsWrite),
  };
}

type ConsoleWriteEvidence = ReturnType<typeof beginConsoleSettingWriteEvidence>;

/** A write that failed may still have reached the firmware: its settings stay
 *  unqualified and its report units unconfirmed. */
export function consoleSettingWriteFailed(
  set: SetFn,
  get: GetFn,
  command: PreparedConsoleCommand,
  evidence: ConsoleWriteEvidence,
  error: unknown,
): void {
  if (evidence.gcodeReportUnits) gcodeReportUnitsStayUnconfirmed(get, command.normalized, error);
  if (!evidence.requalifiesSettings) return;
  const message = error instanceof Error ? error.message : String(error);
  set((state) => failedControllerQualificationPatch(state, evidence.qualificationEpoch, message));
}

/** What the controller holds after an answered write: the units a G-code
 *  units line left (`$G`), then the settings a `$` write stored (`$$`). */
export async function rereadAfterConsoleWrite(
  set: SetFn,
  get: GetFn,
  driver: ControllerDriver,
  command: PreparedConsoleCommand,
  evidence: ConsoleWriteEvidence,
  dispatchRead: (command: PreparedConsoleCommand) => Promise<void>,
): Promise<void> {
  if (evidence.gcodeReportUnits) {
    await rereadReportUnitsAfterConsoleLine(get, driver, command.normalized, dispatchRead);
  }
  if (command.kind !== 'setting-write' && !evidence.reportUnitsWrite) return;
  await rereadSettingsAfterConsoleWrite(
    set,
    get,
    driver,
    command.normalized,
    evidence.reportUnitsWrite,
    dispatchRead,
  );
}

// The controller's dump establishes what a setting write actually stored
// (ADR-375, C-4). A $13 write also keeps position hidden until report units
// are confirmed. The Falcon no-dump command contract remains unchanged.
async function rereadSettingsAfterConsoleWrite(
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
    } else if (get().controllerSessionEpoch === qualificationEpoch) {
      reportStoredSettingMismatch(set, get, driver, written);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    set((state) => failedControllerQualificationPatch(state, qualificationEpoch, message));
    if (reportUnitsWrite) reportUnitsStayUnconfirmed(set, error);
    else settingWriteStaysUnverified(set, written, error);
  }
}

// grblHAL answers `ok` to a value it stored only in part (`$100=26,67` keeps
// 26), so the re-read is compared with what was typed, as the Machine
// Settings writer verifies its own writes (ADR-375 Amendment 4).
function reportStoredSettingMismatch(
  set: SetFn,
  get: GetFn,
  driver: ControllerDriver,
  written: string,
): void {
  const id = Number(/^\$(\d+)=/.exec(written)?.[1]);
  const row = get().grblSettingsRows.find((candidate) => candidate.id === id);
  const issue = consoleSettingReadbackIssue(driver, written, row?.rawValue);
  if (issue === null) return;
  set({ lastWriteError: issue });
  // The Console renders the transcript, which a plain log line never reaches.
  get().pushSystemNotice(`[lf2] ${issue}`);
}
