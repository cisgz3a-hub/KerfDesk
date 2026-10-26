// The Machine stage's one list of machines (ADR-637): every brand laser
// profile and every CNC preset, grouped by brand. The generic firmware
// starters are not machines, so they stay out of the list; "My machine isn't
// listed" covers them with a firmware choice. A withdrawn preset stays out too
// (ADR-660), so a saved copy of it opens as a machine that isn't listed.
// Choosing an entry only changes the setup draft; nothing reaches the project
// before Save.

import { CNC_MACHINE_CATALOG, type CncMachinePreset } from '../../../core/cnc';
import {
  DEFAULT_DEVICE_PROFILE,
  GRBL_MACHINE_PROFILE_CATALOG,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  suggestMachineProfiles,
  type ControllerKind,
  type DeviceProfile,
  type MachineProfileSuggestion,
} from '../../../core/devices';
import { explicitMachineKindsForProfile } from '../../../core/devices/device-profile';
// Deep import: the devices barrel is at its public-export ratchet.
import { presetCommandSetUpdate } from '../../../core/devices/preset-command-set';
import { fillRunwayPolicyForDevice } from '../../../core/job/fill-runway-policy';
import { DEFAULT_CNC_MACHINE_CONFIG, type MachineKind } from '../../../core/scene';
import { controllerProfileForSelection } from './device-setup-controller-selection';
import { deviceSetupSupportsMachineKind } from './device-setup-capability';
import type { DeviceSetupAction, DeviceSetupState } from './device-setup-flow';

export type MachineKindFilter = 'all' | MachineKind;

type EntryBase = {
  readonly id: string;
  readonly name: string;
  readonly brand: string;
  /** The name without its brand, shown under the brand heading. */
  readonly model: string;
  readonly machineKinds: ReadonlyArray<MachineKind>;
  readonly bedWidth: number;
  readonly bedHeight: number;
};

export type MachinePickerEntry =
  | (EntryBase & {
      readonly kind: 'laser-profile';
      readonly opticalPowerW: number | undefined;
      readonly suggestion: MachineProfileSuggestion;
    })
  | (EntryBase & { readonly kind: 'cnc-preset'; readonly preset: CncMachinePreset });

export type MachinePickerGroup = {
  readonly brand: string;
  readonly entries: ReadonlyArray<MachinePickerEntry>;
};

/** The name a renamed or reset custom machine starts with. */
export const CUSTOM_MACHINE_NAME = 'My machine';

export function machinePickerEntries(state: DeviceSetupState): ReadonlyArray<MachinePickerEntry> {
  const suggestions = suggestMachineProfiles({
    detectedControllerKind: state.detectedControllerKind ?? null,
    detectedProfilePatch: state.detected,
    controllerSettings: state.controllerRead ? state.detected : null,
    settingsRows: [],
  });
  const lasers = suggestions
    .filter((item) => !isGenericProfile(item.profile) && item.entry.withdrawn === undefined)
    .map(laserEntry);
  return [...lasers, ...CNC_MACHINE_CATALOG.map(cncEntry)];
}

function laserEntry(suggestion: MachineProfileSuggestion): MachinePickerEntry {
  const profile = suggestion.profile;
  const brand = profile.vendor ?? firstWord(profile.name);
  const kinds = explicitMachineKindsForProfile(profile);
  return {
    kind: 'laser-profile',
    id: suggestion.profileId,
    name: profile.name,
    brand,
    model: withoutBrand(profile.name, brand),
    machineKinds: kinds.length === 0 ? ['laser'] : kinds,
    bedWidth: profile.bedWidth,
    bedHeight: profile.bedHeight,
    opticalPowerW: profile.laserSubProfile?.opticalPowerW,
    suggestion,
  };
}

function cncEntry(preset: CncMachinePreset): MachinePickerEntry {
  const brand = firstWord(preset.name);
  return {
    kind: 'cnc-preset',
    id: `cnc:${preset.id}`,
    name: preset.name,
    brand,
    model: withoutBrand(preset.name, brand),
    machineKinds: ['cnc'],
    bedWidth: preset.bedWidthMm,
    bedHeight: preset.bedHeightMm,
    preset,
  };
}

function isGenericProfile(profile: DeviceProfile): boolean {
  return profile.vendor === 'Generic';
}

function firstWord(name: string): string {
  return name.split(' ')[0] ?? name;
}

function withoutBrand(name: string, brand: string): string {
  return name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name;
}

export function machineKindLabel(kinds: ReadonlyArray<MachineKind>): string {
  if (kinds.includes('laser') && kinds.includes('cnc')) return 'Laser + CNC';
  return kinds.includes('cnc') ? 'CNC' : 'Laser';
}

/** Search by brand, model, type or "WxH" size; then keep one machine type. */
export function filterMachinePickerEntries(
  entries: ReadonlyArray<MachinePickerEntry>,
  query: string,
  kind: MachineKindFilter,
): ReadonlyArray<MachinePickerEntry> {
  const needle = query.trim().toLowerCase();
  return entries.filter(
    (entry) =>
      (kind === 'all' || entry.machineKinds.includes(kind)) &&
      (needle === '' || entrySearchText(entry).includes(needle)),
  );
}

function entrySearchText(entry: MachinePickerEntry): string {
  const size = `${entry.bedWidth}x${entry.bedHeight}`;
  const controller = entry.kind === 'laser-profile' ? entry.suggestion.profile.controllerKind : '';
  return [entry.name, entry.brand, machineKindLabel(entry.machineKinds), size, controller ?? '']
    .join(' ')
    .toLowerCase();
}

/** Brands A to Z; each brand keeps its catalog order. */
export function groupMachinePickerEntries(
  entries: ReadonlyArray<MachinePickerEntry>,
): ReadonlyArray<MachinePickerGroup> {
  const brands = [...new Set(entries.map((entry) => entry.brand))].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'base' }),
  );
  return brands.map((brand) => ({
    brand,
    entries: entries.filter((entry) => entry.brand === brand),
  }));
}

/** The entry the draft currently is, if any. */
export function selectedMachineEntry(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): MachinePickerEntry | undefined {
  return entries.find((entry) => machineEntryIsSelected(state, entry));
}

export function machineEntryIsSelected(
  state: DeviceSetupState,
  entry: MachinePickerEntry,
): boolean {
  if (entry.kind === 'laser-profile') return profilePresetIsActive(state.draft, entry.suggestion);
  const { preset } = entry;
  return (
    state.machineKinds.length === 1 &&
    state.machineKinds[0] === 'cnc' &&
    state.draft.name === preset.name &&
    state.draft.bedWidth === preset.bedWidthMm &&
    state.draft.bedHeight === preset.bedHeightMm &&
    state.cncDraft.params.spindleMaxRpm === preset.spindleMaxRpm
  );
}

function profilePresetIsActive(
  draft: DeviceProfile,
  suggestion: MachineProfileSuggestion,
): boolean {
  if (draft.profileId !== suggestion.profile.profileId) return false;
  if (draftLacksPresetCommandSet(draft, suggestion)) return false;
  if (suggestion.profile.profileId !== NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.profileId) return true;
  return fillRunwayPolicyForDevice(draft) !== undefined;
}

// A copy saved before its preset carried a vendor command set connects with the
// generic driver, whose Frame sends M9 just before Start (ADR-323). It is not
// the preset, so it stays unselected and choosing it re-applies the preset.
// Job Review names the same copies (ADR-375).
export function draftLacksPresetCommandSet(
  draft: DeviceProfile,
  suggestion: MachineProfileSuggestion,
): boolean {
  return draft.profileId === suggestion.profile.profileId && presetCommandSetUpdate(draft) !== null;
}

/** The listed laser profile the draft is, however edited. */
export function listedProfileOf(
  draft: DeviceProfile,
  entries: ReadonlyArray<MachinePickerEntry>,
): DeviceProfile | undefined {
  const entry = entries.find(
    (item) => item.kind === 'laser-profile' && item.suggestion.profileId === draft.profileId,
  );
  return entry?.kind === 'laser-profile' ? entry.suggestion.profile : undefined;
}

function draftIsListedProfile(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): boolean {
  return listedProfileOf(state.draft, entries) !== undefined;
}

/** Whether the draft is a machine from the list: a chosen row, or a listed
 *  laser profile however edited. */
export function draftIsListedMachine(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): boolean {
  return selectedMachineEntry(state, entries) !== undefined || draftIsListedProfile(state, entries);
}

/**
 * A draft that is neither a listed machine nor the untouched starter is a
 * machine of the operator's own: imported, filled in from the controller, or
 * set up earlier as not listed.
 */
export function draftIsCustomMachine(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): boolean {
  if (selectedMachineEntry(state, entries) !== undefined) return false;
  return !draftIsListedProfile(state, entries) && !draftIsUntouchedStarter(state);
}

/** The draft actions that make the setup this machine. */
export function chooseMachineEntryActions(
  state: DeviceSetupState,
  entry: MachinePickerEntry,
): ReadonlyArray<DeviceSetupAction> {
  if (entry.kind === 'laser-profile') {
    return [{ kind: 'apply-preset', profile: entry.suggestion.profile }];
  }
  // A CNC preset is geometry and a spindle ceiling only, and keeps the selected
  // controller. On top of a listed laser profile it starts from the generic
  // starter instead, so no laser brand's values stay behind under a CNC name;
  // a Laser + CNC machine's CNC values (the 4040's spindle sub-profile) are its
  // brand's too, so they go back to the defaults.
  const { preset } = entry;
  const listed = draftIsListedProfile(state, machinePickerEntries(state));
  const reset: ReadonlyArray<DeviceSetupAction> = listed
    ? [{ kind: 'apply-preset', profile: starterProfile(state.draft) }]
    : [];
  const params =
    listed && deviceSetupSupportsMachineKind(state, 'cnc')
      ? DEFAULT_CNC_MACHINE_CONFIG.params
      : state.cncDraft.params;
  return [
    ...reset,
    { kind: 'set-machine-kinds', machineKinds: ['cnc'] },
    {
      kind: 'edit',
      patch: { name: preset.name, bedWidth: preset.bedWidthMm, bedHeight: preset.bedHeightMm },
    },
    {
      kind: 'edit-machine',
      machine: {
        ...state.cncDraft,
        params: { ...params, spindleMaxRpm: preset.spindleMaxRpm },
      },
    },
  ];
}

/**
 * Choosing "My machine isn't listed" while a listed machine is in the draft
 * starts again from the generic starter for the same controller, keeping the
 * work area. The untouched starter is named, so the choice is in the draft and
 * survives leaving the stage. A draft that is already custom stays as it is.
 */
export function chooseCustomMachineActions(
  state: DeviceSetupState,
  entries: ReadonlyArray<MachinePickerEntry>,
): ReadonlyArray<DeviceSetupAction> {
  if (!draftIsListedMachine(state, entries)) {
    return draftIsUntouchedStarter(state)
      ? [{ kind: 'edit', patch: { name: CUSTOM_MACHINE_NAME } }]
      : [];
  }
  return [
    {
      kind: 'apply-preset',
      profile: {
        ...starterProfile(state.draft),
        name: CUSTOM_MACHINE_NAME,
        bedWidth: state.draft.bedWidth,
        bedHeight: state.draft.bedHeight,
      },
    },
  ];
}

export function starterProfile(draft: DeviceProfile): DeviceProfile {
  return controllerProfileForSelection(DEFAULT_DEVICE_PROFILE, draft.controllerKind ?? 'grbl-v1.1');
}

/**
 * The firmware choice of "My machine isn't listed" (ADR-637 Amendment 1). A
 * draft that is still a firmware starter, apart from its name, type and work
 * area, starts from the chosen firmware's own starter (Ruida's rear-right origin
 * and 900 × 600 mm, Marlin's S range and capabilities), keeping its name, its
 * type and a work area the operator typed. Any other draft changes its
 * controller only, as Connection options does.
 */
export function chooseCustomFirmwareActions(
  state: DeviceSetupState,
  controllerKind: ControllerKind,
): ReadonlyArray<DeviceSetupAction> {
  const current = firmwareStarterProfiles(state.draft.controllerKind ?? 'grbl-v1.1').find(
    (starter) => sameStarterValues(state.draft, starter),
  );
  const next = firmwareStarter(controllerKind);
  if (current === undefined || next === undefined) {
    return [{ kind: 'select-controller', controllerKind }];
  }
  const typedArea =
    state.draft.bedWidth !== current.bedWidth || state.draft.bedHeight !== current.bedHeight;
  const area = typedArea
    ? { bedWidth: state.draft.bedWidth, bedHeight: state.draft.bedHeight }
    : {};
  return [{ kind: 'apply-preset', profile: { ...next, name: state.draft.name, ...area } }];
}

/** What a draft of this firmware starts from: the starter with the firmware
 *  selected, and the generic starter KerfDesk ships for it. */
export function firmwareStarterProfiles(kind: ControllerKind): ReadonlyArray<DeviceProfile> {
  const generic = firmwareStarter(kind);
  return [
    controllerProfileForSelection(DEFAULT_DEVICE_PROFILE, kind),
    ...(generic === undefined ? [] : [generic]),
  ];
}

// The type is asked on its own in the form, so a starter brings no output kind.
function firmwareStarter(kind: ControllerKind): DeviceProfile | undefined {
  const generic = GRBL_MACHINE_PROFILE_CATALOG.find(
    (item) =>
      isGenericProfile(item.profile) && (item.profile.controllerKind ?? 'grbl-v1.1') === kind,
  )?.profile;
  if (generic === undefined) return undefined;
  const capabilities = (generic.capabilities ?? []).filter(
    (capability) => capability !== 'laser-output' && capability !== 'cnc-output',
  );
  return { ...generic, capabilities };
}

function sameStarterValues(draft: DeviceProfile, starter: DeviceProfile): boolean {
  const shape = (profile: DeviceProfile) => ({ ...profile, name: '', bedWidth: 0, bedHeight: 0 });
  return sameSetupValue(shape(draft), shape(starter));
}

/** Deep equality of draft values, whatever order their keys were written in. */
export function sameSetupValue(a: unknown, b: unknown): boolean {
  return stableJson(a) === stableJson(b);
}

function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** The shipped starter machine, untouched: nothing has been chosen yet. */
function draftIsUntouchedStarter(state: DeviceSetupState): boolean {
  const draft = state.draft;
  return (
    draft.profileId === DEFAULT_DEVICE_PROFILE.profileId &&
    draft.name === DEFAULT_DEVICE_PROFILE.name &&
    draft.bedWidth === DEFAULT_DEVICE_PROFILE.bedWidth &&
    draft.bedHeight === DEFAULT_DEVICE_PROFILE.bedHeight
  );
}
