// laser-owned-reset-settings — the `$$` and `$I` snapshot that a reset
// KerfDesk sent itself carries across that reset's boot banner (ADR-648,
// controller design audit 2026-10-20 D-5).
//
// GRBL keeps its `$` settings and `$I` build string in EEPROM, and a soft reset
// reloads them unchanged. Only the parser's modal state and active WCS start
// again, so the banner that closes an owned reset re-reads `$G` alone. Any
// other banner, and any `$` assignment or FluidNC `$NVX` erase sent since the
// last `$$` read (`$N=`, `$RST=`, `$I=`, a job line), still discards the
// snapshot and re-reads all.
// `$$` does not report the `$I` string, so a `$I=` or `$RST=` write stays
// outstanding for the `$I` evidence until `$I` itself is read again.

import type { ControllerSettingsSnapshot, GrblSettingRow } from '../../core/controllers/grbl';
import {
  isBuildInfoWriteLine,
  isStoredSettingWriteLine,
} from '../../core/controllers/grbl/eeprom-write-line';
import type { DeviceProfile } from '../../core/devices';
import type { LaserState } from './laser-store';

export type OwnedResetSettingsRefs = {
  /** Counts the `$` assignments sent to the controller. */
  settingsWriteRevision?: number;
  /** settingsWriteRevision when the current `$$` snapshot was read. */
  settingsReadRevision?: number;
  /** Counts the writes that can change what `$I` reports (`$I=`, `$RST=`). */
  buildInfoWriteRevision?: number;
  /** buildInfoWriteRevision when `$I` was last read. */
  buildInfoReadRevision?: number;
};

type BuildInfoEvidence = Pick<
  LaserState,
  'controllerBuildInfo' | 'controllerBuildInfoRawLines' | 'controllerBuildInfoObservation'
>;

export type RetainedControllerSettings = {
  readonly connection: unknown;
  readonly controllerSettings: ControllerSettingsSnapshot;
  readonly grblSettingsRows: ReadonlyArray<GrblSettingRow>;
  readonly detectedSettings: Partial<DeviceProfile> | null;
  readonly observedAt: number;
  readonly lastSettingsReadAt: number;
  readonly buildInfo: BuildInfoEvidence | null;
};

/** Any write, or a whole program: the streamer sends a program's `$` lines
 * alone (ADR-644), so once it starts any of them may have reached EEPROM. */
export function noteControllerSettingWrite(refs: OwnedResetSettingsRefs, text: string): void {
  if (!text.includes('$') && !text.includes('[')) return;
  const lines = text.split('\n');
  if (lines.some(isStoredSettingWriteLine)) {
    refs.settingsWriteRevision = (refs.settingsWriteRevision ?? 0) + 1;
  }
  if (lines.some(isBuildInfoWriteLine)) {
    refs.buildInfoWriteRevision = (refs.buildInfoWriteRevision ?? 0) + 1;
  }
}

export function noteControllerSettingsRead(refs: OwnedResetSettingsRefs): void {
  refs.settingsReadRevision = refs.settingsWriteRevision ?? 0;
}

export function noteControllerBuildInfoRead(refs: OwnedResetSettingsRefs): void {
  refs.buildInfoReadRevision = refs.buildInfoWriteRevision ?? 0;
}

type RetainRefs = OwnedResetSettingsRefs & {
  readonly settingsCollector?: { readonly kind: string };
};

/** The current session's completed `$$` read, when nothing has written a
 * setting since and no replacement read is in flight. */
export function retainableControllerSettings(
  state: LaserState,
  refs: RetainRefs,
  connection: unknown,
): RetainedControllerSettings | null {
  const observation = state.controllerSettingsObservation;
  const settings = state.controllerSettings;
  const readAt = state.lastSettingsReadAt;
  if (observation === null || settings === null || readAt === null) return null;
  if (!snapshotStillHolds(state, refs)) return null;
  return {
    connection,
    controllerSettings: settings,
    grblSettingsRows: state.grblSettingsRows,
    detectedSettings: state.detectedSettings,
    observedAt: observation.observedAt,
    lastSettingsReadAt: readAt,
    buildInfo: currentBuildInfo(state, refs),
  };
}

function snapshotStillHolds(state: LaserState, refs: RetainRefs): boolean {
  return (
    state.connection.kind === 'connected' &&
    sessionSettingsReadHolds(state, state.controllerSessionEpoch, refs) &&
    refs.settingsCollector?.kind !== 'collecting'
  );
}

/** This session's `$I` evidence, unless a write since may have changed it; the
 * `$G`-only re-read then reads `$I` again. */
function currentBuildInfo(state: LaserState, refs: RetainRefs): BuildInfoEvidence | null {
  if (
    state.controllerBuildInfoObservation?.sessionEpoch !== state.controllerSessionEpoch ||
    (refs.buildInfoReadRevision ?? 0) !== (refs.buildInfoWriteRevision ?? 0)
  ) {
    return null;
  }
  return {
    controllerBuildInfo: state.controllerBuildInfo,
    controllerBuildInfoRawLines: state.controllerBuildInfoRawLines,
    controllerBuildInfoObservation: state.controllerBuildInfoObservation,
  };
}

/** The snapshot, re-stamped for the session the banner opened (nothing when
 * the banner kept none). The read time stays the original one, so nothing
 * announces a read that did not happen. */
export function retainedControllerSettingsPatch(
  retained: RetainedControllerSettings | null,
  sessionEpoch: number,
): Partial<LaserState> {
  if (retained === null) return {};
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

/** This session holds a completed `$$` read: its own, or one an owned reset kept. */
export function hasSessionSettingsRead(state: LaserState, sessionEpoch: number): boolean {
  return (
    state.controllerSessionEpoch === sessionEpoch &&
    state.controllerSettingsObservation?.sessionEpoch === sessionEpoch &&
    state.lastSettingsReadAt !== null &&
    state.grblSettingsRows.length > 0
  );
}

/** This session's `$$` read, when no `$` setting has been written since it. */
export function sessionSettingsReadHolds(
  state: LaserState,
  sessionEpoch: number,
  refs: OwnedResetSettingsRefs,
): boolean {
  return (
    hasSessionSettingsRead(state, sessionEpoch) &&
    (refs.settingsReadRevision ?? 0) === (refs.settingsWriteRevision ?? 0)
  );
}
