// F-7 — detected-settings flow for the laser store.
//
// On connect, the handshake fires `$$` and starts a pure collector
// state machine (core/controllers/grbl/parse-settings). As setting
// lines stream in the collector accumulates them; on the trailing
// `ok` it produces a `Partial<DeviceProfile>` describing what the
// machine reports. This module owns:
//   1. `consumeSettingsResponse` — the per-line driver run inside
//      handleLine that advances the collector and publishes the
//      patch when the window closes.
//   2. `applyDetectedSettings` / `dismissDetectedSettings` — the
//      two actions the LaserPanel banner dispatches.
//
// Kept separate from laser-store.ts so that file stays under the
// 400-line hard cap and the connection lifecycle isn't tangled
// with detection-specific logic.

import {
  collectorOnResponse,
  type GrblSettingRow,
  idleCollector,
  startCollecting,
  type SettingsCollectorState,
  type ControllerSettingsSnapshot,
} from '../../core/controllers/grbl';
import type { ControllerEvent } from '../../core/controllers';
import type { DeviceProfile } from '../../core/devices';
import { useStore } from './store';
import { cncLiveCapsFromController } from './cnc-controller-caps';

export type DetectedSettingsRefs = {
  // The pure state machine. Owned by the laser-store's `refs` object;
  // we mutate the same reference rather than passing it in/out of every
  // call so the line-dispatch path doesn't have to thread it manually.
  settingsCollector: SettingsCollectorState;
  settingsCollectorSessionEpoch: number | null;
};

export const SETTINGS_READ_OPERATION_LABEL = 'Reading controller settings';

export function beginSettingsCollection(refs: DetectedSettingsRefs, sessionEpoch: number): void {
  // The previous dump is no longer qualified while a replacement read is in
  // flight. Future automatic CNC values must wait for the new observation.
  clearCncLiveCaps();
  refs.settingsCollector = startCollecting();
  refs.settingsCollectorSessionEpoch = sessionEpoch;
}

export type DetectedSettingsResult = {
  readonly patch: Partial<DeviceProfile>;
  readonly controllerSettings: ControllerSettingsSnapshot;
  readonly settingsRows: ReadonlyArray<GrblSettingRow>;
};

// Feed one classified response to the collector. Returns the patch if
// the window just closed (collector reached `done`), otherwise null.
// Callers (handleLine in laser-store) should publish the patch to
// LaserState.detectedSettings when non-null.
export function consumeSettingsResponse(
  refs: DetectedSettingsRefs,
  response: ControllerEvent,
  sessionEpoch: number,
): DetectedSettingsResult | null {
  if (refs.settingsCollectorSessionEpoch !== sessionEpoch) {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
    return null;
  }
  const next = collectorOnResponse(refs.settingsCollector, response);
  if (next.kind === 'done') {
    refs.settingsCollector = idleCollector();
    refs.settingsCollectorSessionEpoch = null;
    if (
      Object.keys(next.patch).length === 0 &&
      Object.keys(next.controllerSettings).length === 0 &&
      next.settingsRows.length === 0
    ) {
      return null;
    }
    return {
      patch: next.patch,
      controllerSettings: next.controllerSettings,
      settingsRows: next.settingsRows,
    };
  }
  refs.settingsCollector = next;
  return null;
}

// Apply the pending patch to the active project's DeviceProfile.
// Returns true if a patch was applied, false when called with no
// pending detection (defensive — UI buttons should be disabled but
// nothing breaks if a stale click slips through).
export function applyDetectedSettingsPatch(patch: Partial<DeviceProfile> | null): boolean {
  if (patch === null) return false;
  // useStore (project store) is independent of useLaserStore; both
  // are top-level Zustand stores. getState() avoids a parameter pipe
  // through every layer of the laser-store actions object.
  useStore.getState().updateDeviceProfile(patch);
  return true;
}

export function publishCncLiveCaps(settings: ControllerSettingsSnapshot): void {
  useStore.getState().setCncLiveCaps(cncLiveCapsFromController(settings));
}

export function clearCncLiveCaps(): void {
  useStore.getState().setCncLiveCaps(null);
}
