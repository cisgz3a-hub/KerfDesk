// Use detected values and Find my machine's fill (ADR-347, ADR-420). The
// controller reports one machine, but the laser and CNC keep their own Max
// feed (ADR-416), so the reported max rate ($110/$111) fills the Max feed of
// each head the setup includes: the device profile's for the laser, CNC's own
// params for the router. Power and laser mode stay the laser's.

import { controllerCompatibleProfile, type DeviceProfile } from '../../../core/devices';
import { deviceProfileWithInteractivePatch } from '../../../core/devices/device-profile-patch';
import { cncMaxFeedMmPerMin } from '../../../core/cnc/cnc-head-feeds';
import type { CncMachineConfig } from '../../../core/scene';
import { numbersClose } from '../../../core/util';
import { describePatch } from '../DetectedSettingsBanner';
import { deviceSetupSupportsMachineKind } from './device-setup-capability';
import type { DeviceSetupState } from './device-setup-flow';

type ChangeRow = ReturnType<typeof describePatch>[number];

export function acceptDetectedPatch(
  state: DeviceSetupState,
  patch: Partial<DeviceProfile>,
  useSpindleScaleAsRpm: boolean,
): Partial<DeviceSetupState> {
  const draft = controllerCompatibleProfile(
    deviceProfileWithInteractivePatch(state.draft, profilePatchForSetup(state, patch)),
    state.draft.controllerKind,
  ).profile;
  const cncDraft = cncDraftWithDetected(state, patch, useSpindleScaleAsRpm);
  return {
    detected: patch,
    draft,
    detectedApplied: true,
    ...(cncDraft === state.cncDraft
      ? {}
      : { cncDraft, ...(state.machineKind === 'cnc' ? { draftMachine: cncDraft } : {}) }),
  };
}

/** What accepting the controller's values changes between two setup states,
 *  with Max feed told apart per head. */
export function setupChangeRows(
  before: DeviceSetupState,
  after: DeviceSetupState,
): ReadonlyArray<ChangeRow> {
  const rows = [...describePatch({ ...after.draft, maxFeed: before.draft.maxFeed }, before.draft)];
  const cnc = deviceSetupSupportsMachineKind(after, 'cnc');
  if (deviceSetupSupportsMachineKind(after, 'laser')) {
    const label = cnc ? 'Laser max feed' : 'Max feed';
    pushFeedRow(rows, label, before.draft.maxFeed, after.draft.maxFeed);
  }
  if (cnc) {
    pushFeedRow(
      rows,
      'CNC max feed',
      cncMaxFeedMmPerMin(before.draft, before.cncDraft.params),
      cncMaxFeedMmPerMin(after.draft, after.cncDraft.params),
    );
  }
  return rows;
}

function pushFeedRow(rows: ChangeRow[], label: string, prev: number, next: number): void {
  if (numbersClose(prev, next)) return;
  rows.push({
    label,
    oldText: `${Math.round(prev)} mm/min`,
    newText: `${Math.round(next)} mm/min`,
    changed: true,
  });
}

function profilePatchForSetup(
  state: DeviceSetupState,
  patch: Partial<DeviceProfile>,
): Partial<DeviceProfile> {
  const shared = { ...patch };
  if (state.machineKind === 'cnc') {
    delete shared.maxPowerS;
    delete shared.minPowerS;
    delete shared.laserModeEnabled;
  }
  // Without a laser the device's Max feed is no head's; CNC takes its own below.
  if (!deviceSetupSupportsMachineKind(state, 'laser')) delete shared.maxFeed;
  return shared;
}

function cncDraftWithDetected(
  state: DeviceSetupState,
  patch: Partial<DeviceProfile>,
  useSpindleScaleAsRpm: boolean,
): CncMachineConfig {
  const maxFeedMmPerMin = detectedCncMaxFeed(state, patch);
  const spindleMaxRpm = useSpindleScaleAsRpm ? detectedSpindleMaxRpm(state, patch) : undefined;
  if (maxFeedMmPerMin === undefined && spindleMaxRpm === undefined) return state.cncDraft;
  return {
    ...state.cncDraft,
    params: {
      ...state.cncDraft.params,
      ...(maxFeedMmPerMin === undefined ? {} : { maxFeedMmPerMin }),
      ...(spindleMaxRpm === undefined ? {} : { spindleMaxRpm }),
    },
  };
}

function detectedCncMaxFeed(
  state: DeviceSetupState,
  patch: Partial<DeviceProfile>,
): number | undefined {
  if (!deviceSetupSupportsMachineKind(state, 'cnc')) return undefined;
  return positive(patch.maxFeed) ? patch.maxFeed : undefined;
}

// $32=0 alone does not make a configured PWM scale into physical RPM, so $30
// is copied only when the operator explicitly chooses that mapping.
function detectedSpindleMaxRpm(
  state: DeviceSetupState,
  patch: Partial<DeviceProfile>,
): number | undefined {
  if (state.machineKind !== 'cnc' || patch.laserModeEnabled !== false) return undefined;
  return positive(patch.maxPowerS) ? patch.maxPowerS : undefined;
}

function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
