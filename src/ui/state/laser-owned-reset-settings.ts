// laser-owned-reset-settings — the `$$` and `$I` snapshot that a reset
// KerfDesk sent itself carries across that reset's boot banner (ADR-648,
// controller design audit 2026-10-20 D-5).
//
// GRBL keeps its `$` settings and `$I` build string in EEPROM, and a soft reset
// reloads them unchanged. Only the parser's modal state and active WCS start
// again, so the banner that closes an owned reset re-reads `$G` alone. Any
// other banner, and any `$` assignment sent since the last `$$` read (`$N=`,
// `$RST=`, `$I=`, a job line), still discards the snapshot and re-reads all.

import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import { isSettingAssignmentLine } from '../../core/controllers/grbl/eeprom-write-line';
import type { DeviceProfile } from '../../core/devices';
import type { ControllerBuildInfoState } from './laser-controller-build-info';
import type { LaserState } from './laser-store';

export type OwnedResetSettingsRefs = {
  /** Counts the `$` assignments sent to the controller. */
  settingsWriteRevision?: number;
  /** settingsWriteRevision when the current `$$` snapshot was read. */
  settingsReadRevision?: number;
};

export type RetainedControllerSettings = {
  readonly connection: unknown;
  readonly controllerSettings: ControllerSettingsSnapshot;
  readonly grblSettingsRows: ReadonlyArray<GrblSettingRow>;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly observedAt: number;
  readonly lastSettingsReadAt: number;
  readonly buildInfo: ControllerBuildInfoState | null;
};

/** Any write, or a whole program: the streamer sends a program's `$` lines
 * alone (ADR-644), so once it starts any of them may have reached EEPROM. */
export function noteControllerSettingWrite(refs: OwnedResetSettingsRefs, text: string): void {
  if (text.includes('$') && text.split('\n').some(isSettingAssignmentLine)) {
    refs.settingsWriteRevision = (refs.settingsWriteRevision ?? 0) + 1;
  }
}

export function noteControllerSettingsRead(refs: OwnedResetSettingsRefs): void {
  refs.settingsReadRevision = refs.settingsWriteRevision ?? 0;
}

/** The current session's completed `$$` read, when nothing has written a
 * setting since and no replacement read is in flight. */
export function retainableControllerSettings(
  state: LaserState,
  refs: OwnedResetSettingsRefs & { readonly settingsCollector?: { readonly kind: string } },
  connection: unknown,
): RetainedControllerSettings | null {
  const epoch = state.controllerSessionEpoch;
  const observation = state.controllerSettingsObservation;
  if (
    state.connection.kind !== 'connected' ||
    observation?.sessionEpoch !== epoch ||
    state.controllerSettings === null ||
    state.lastSettingsReadAt === null ||
    state.grblSettingsRows.length === 0 ||
    refs.settingsCollector?.kind === 'collecting' ||
    (refs.settingsReadRevision ?? 0) !== (refs.settingsWriteRevision ?? 0)
  ) {
    return null;
  }
  return {
    connection,
    controllerSettings: state.controllerSettings,
    grblSettingsRows: state.grblSettingsRows,
    detectedSettings: state.detectedSettings,
    observedAt: observation.observedAt,
    lastSettingsReadAt: state.lastSettingsReadAt,
    buildInfo:
      state.controllerBuildInfoObservation?.sessionEpoch === epoch
        ? {
            controllerBuildInfo: state.controllerBuildInfo,
            controllerBuildInfoRawLines: state.controllerBuildInfoRawLines,
            controllerBuildInfoObservation: state.controllerBuildInfoObservation,
          }
        : null,
  };
}

/** The snapshot, re-stamped for the session the banner opened. The read time
 * stays the original one, so nothing announces a read that did not happen. */
export function retainedControllerSettingsPatch(
  retained: RetainedControllerSettings,
  sessionEpoch: number,
): Partial<LaserState> {
  const buildInfo = retained.buildInfo;
  return {
    controllerSettings: retained.controllerSettings,
    controllerSettingsObservation: { sessionEpoch, observedAt: retained.observedAt },
    grblSettingsRows: retained.grblSettingsRows,
    detectedSettings: retained.detectedSettings,
    lastSettingsReadAt: retained.lastSettingsReadAt,
    ...(buildInfo === null || buildInfo.controllerBuildInfoObservation === null
      ? {}
      : {
          ...buildInfo,
          controllerBuildInfoObservation: {
            sessionEpoch,
            observedAt: buildInfo.controllerBuildInfoObservation.observedAt,
          },
        }),
  };
}

/** Settings kept from before this session's owned reset, still unchanged. */
export function hasRetainedSettingsForSession(state: LaserState, sessionEpoch: number): boolean {
  return (
    state.controllerSessionEpoch === sessionEpoch &&
    state.controllerSettingsObservation?.sessionEpoch === sessionEpoch &&
    state.lastSettingsReadAt !== null &&
    state.grblSettingsRows.length > 0
  );
}
