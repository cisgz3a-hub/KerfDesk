// What choosing another machine in the list would throw away (ADR-637
// Amendment 1). A choice replaces the draft's values with the new machine's,
// which is what choosing means, so a draft that is still a listed machine or a
// firmware starter changes at once. Values someone set (tuned on Essentials,
// saved with this machine, or a listed profile edited) are named first, so one
// click, or arrowing through the list, never discards them unseen. Values the
// controller reported are not counted: connecting brings them back.

import type { DeviceProfile } from '../../../core/devices';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../../core/scene';
import { controllerProfileForSelection } from './device-setup-controller-selection';
import {
  deviceSetupReducer,
  deviceSetupSupportsMachineKind,
  type DeviceSetupAction,
  type DeviceSetupState,
} from './device-setup-flow';
import {
  firmwareStarterProfiles,
  listedProfileOf,
  sameSetupValue,
  type MachinePickerEntry,
} from './machine-picker-entries';

const TUNED_SETTINGS: ReadonlyArray<{
  readonly label: string;
  readonly keys: ReadonlyArray<keyof DeviceProfile>;
}> = [
  { label: 'max feed', keys: ['maxFeed'] },
  { label: 'S range', keys: ['minPowerS', 'maxPowerS'] },
  { label: 'origin and homing', keys: ['origin', 'homing'] },
  { label: 'frame speed', keys: ['framingFeedMmPerMin'] },
  { label: 'no-go zones', keys: ['noGoZones'] },
  { label: 'scan-offset calibration', keys: ['scanningOffsets', 'scanOffsetCalibrationStatus'] },
  { label: 'camera calibration', keys: ['cameraProfile', 'cameraModel', 'otherCameraModels'] },
  { label: 'rotary setup', keys: ['rotary'] },
  { label: 'saved positions', keys: ['savedPositions'] },
];

/** The draft's own settings that `actions` would replace, as plain labels. */
export function machineChoiceReplaces(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
  actions: ReadonlyArray<DeviceSetupAction>,
): ReadonlyArray<string> {
  if (actions.length === 0) return [];
  const next = actions.reduce(deviceSetupReducer, state);
  const sources = sourceProfiles(state, entries);
  const replaced = TUNED_SETTINGS.filter(({ keys }) =>
    keys.some(
      (key) =>
        tunedProfileValue(state, sources, key) &&
        !sameSetupValue(next.draft[key], state.draft[key]),
    ),
  ).map((setting) => setting.label);
  return cncSettingsReplaced(state, next, entries) ? [...replaced, 'CNC settings'] : replaced;
}

// Where the draft's values came from: the listed profile it is, or the starter
// for its firmware. A value that matches any of them is nobody's tuning.
function sourceProfiles(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): ReadonlyArray<DeviceProfile> {
  const kind = state.draft.controllerKind ?? 'grbl-v1.1';
  const listed = listedProfileOf(state.draft, entries);
  if (listed === undefined) return firmwareStarterProfiles(kind);
  return [listed, controllerProfileForSelection(listed, kind)];
}

function tunedProfileValue(
  state: DeviceSetupState,
  sources: ReadonlyArray<DeviceProfile>,
  key: keyof DeviceProfile,
): boolean {
  const value = state.draft[key];
  if (sources.some((source) => sameSetupValue(source[key], value))) return false;
  return !(key in state.detected && sameSetupValue(state.detected[key], value));
}

// A machine's CNC values count only when it has a CNC head. Each CNC choice
// brings its own spindle ceiling, and a reported max rate comes back on connect.
function cncSettingsReplaced(
  state: DeviceSetupState,
  next: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): boolean {
  if (!deviceSetupSupportsMachineKind(state, 'cnc')) return false;
  const params = state.cncDraft.params;
  const source = listedProfileOf(state.draft, entries)?.cncSubProfile;
  const reference: Partial<Record<string, unknown>> = source ?? DEFAULT_CNC_MACHINE_CONFIG.params;
  const reported = state.detected.maxFeed;
  return Object.entries(params).some(
    ([key, value]) =>
      key !== 'spindleMaxRpm' &&
      !(key === 'maxFeedMmPerMin' && value === reported) &&
      !sameSetupValue(reference[key], value) &&
      !sameSetupValue((next.cncDraft.params as Partial<Record<string, unknown>>)[key], value),
  );
}

/** "a, b and c" */
export function joinSettingLabels(labels: ReadonlyArray<string>): string {
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1] ?? ''}`;
}
