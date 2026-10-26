// The scheduler's qualification run (ADR-648). After the banner of a reset
// KerfDesk sent, the `$$` and `$I` snapshot that reset kept still describes
// EEPROM, so only the modal state and active WCS the reset restarted are read
// again, however often the session's qualification is rescheduled. Without
// that snapshot it falls back to the full settings read.

import {
  assertSettingsCommandOwnership,
  blockRead,
  BUILD_INFO_READ_OPERATION_LABEL,
  clearInteractiveOperation,
  failSettingsOperation,
  refreshControllerBuildInfo,
  type GrblSettingsActionRefs,
} from './grbl-settings-actions';
import { readOnlyControllerOperation } from './laser-controller-operation';
import { qualifiedController } from './laser-controller-qualification';
import {
  sessionSettingsReadHolds,
  type OwnedResetSettingsRefs,
} from './laser-owned-reset-settings';
import type { LaserSafetyAction } from './laser-safety-notice';
import { pushLog } from './laser-store-helpers';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import { requestTerminalOwnedActiveWcsReadback } from './terminal-owned-wcs-readback';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;
type WriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

const WCS_READ_OPERATION_LABEL = 'Reading active work coordinates';

export async function readModalStateAfterOwnedReset(
  set: SetFn,
  get: GetFn,
  refs: GrblSettingsActionRefs & OwnedResetSettingsRefs,
  write: WriteFn,
  readMachineSettings: () => Promise<void>,
): Promise<void> {
  const epoch = get().controllerSessionEpoch;
  // A `$` write since the kept read (say a Console `$30=` while the
  // qualification waited) may have changed EEPROM, so read `$$` again.
  if (!sessionSettingsReadHolds(get(), epoch, refs)) return readMachineSettings();
  const blocked = machineSettingsReadBlockReason(get(), {
    settingsCollectionActive: refs.settingsCollector.kind === 'collecting',
    resetCleanupPending: refs.pendingResetCleanup != null,
  });
  if (blocked !== null) return blockRead(set, get, blocked);
  // `$I` too when this session never read it (it failed or was skipped).
  const readBuildInfo =
    refs.driver.commands.buildInfoQuery !== null &&
    get().controllerBuildInfoObservation?.sessionEpoch !== epoch;
  // The kept `$$` read is this session's verified settings, as a fresh read
  // would be once its dump completes.
  set({
    controllerOperation: readOnlyControllerOperation(
      readBuildInfo ? BUILD_INFO_READ_OPERATION_LABEL : WCS_READ_OPERATION_LABEL,
    ),
    controllerQualification: qualifiedController(epoch, 'verified'),
  });
  try {
    assertSettingsCommandOwnership(get);
    if (readBuildInfo) {
      await refreshControllerBuildInfo(set, get, refs, write, epoch);
      assertSettingsCommandOwnership(get);
      set((state) =>
        state.controllerSessionEpoch === epoch
          ? { controllerOperation: readOnlyControllerOperation(WCS_READ_OPERATION_LABEL) }
          : {},
      );
    }
    await requestTerminalOwnedActiveWcsReadback(get, refs, write, epoch, 'interactive-command');
    assertSettingsCommandOwnership(get);
    set((state) =>
      state.controllerSessionEpoch === epoch
        ? {
            log: pushLog(
              state,
              '[lf2] Controller settings kept across the reset KerfDesk sent; modal state re-read.',
            ),
          }
        : {},
    );
    clearInteractiveOperation(set, epoch);
  } catch (err) {
    failSettingsOperation(set, refs, epoch, 'read', err);
  }
}
