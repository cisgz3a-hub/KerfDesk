// Corrections to built-in presets that a saved copy cannot pick up.
//
// Device profiles are saved whole (see preset-air-assist.ts), so a correction
// to the catalog never reaches a profile saved before it. Each entry records the
// value the preset used to ship. A saved copy of that preset that still holds
// exactly that value predates the correction; any other value is the
// operator's own and is left alone (ADR-322 Amendment 1; 2026-09-25 PR audit,
// SET-1). Only corrections that fail silently are listed: a wrong baud rate
// fails at Connect and needs no note.
import type { DeviceProfile } from './device-profile';
import { profileCatalogEntryById } from './profile-catalog';

type CorrectableFields = Pick<DeviceProfile, 'origin' | 'bedWidth' | 'bedHeight'>;

type PresetCorrection = {
  readonly profileIds: ReadonlyArray<string>;
  readonly before: string;
  readonly now: string;
  readonly effect: string;
  /** The fields the correction changed; their preset values are the fix. */
  readonly fields: ReadonlyArray<keyof CorrectableFields>;
  readonly predates: (device: CorrectableFields) => boolean;
};

// #894, 2026-09-24. xTool's LightBurn device file for the D1 Pro sets
// "MirrorY": true, and the S30's product page gives a 380 x 385 mm area.
const PRESET_CORRECTIONS: ReadonlyArray<PresetCorrection> = [
  {
    profileIds: ['xtool-d1-pro', 'xtool-d1-pro-5w', 'xtool-d1-pro-10w', 'xtool-d1-pro-40w'],
    before: 'origin front-left',
    now: 'rear-left',
    effect: 'jobs come out mirrored front to back',
    fields: ['origin'],
    predates: (device) => device.origin === 'front-left',
  },
  {
    profileIds: ['sculpfun-s30', 'sculpfun-s30-manual-air'],
    before: 'bed 410 x 400 mm',
    now: '380 x 385 mm',
    effect: 'a job near the edge can run past the real travel',
    fields: ['bedWidth', 'bedHeight'],
    predates: (device) => device.bedWidth === 410 && device.bedHeight === 400,
  },
];

export type StalePresetCorrection = {
  readonly presetName: string;
  readonly before: string;
  readonly now: string;
  readonly effect: string;
  /** The preset's corrected values, for Machine Setup's one-click offer. */
  readonly patch: Partial<CorrectableFields>;
};

/** The corrections a saved preset copy still predates; empty for any other profile. */
export function stalePresetCorrections(
  device: Pick<DeviceProfile, 'profileId'> & CorrectableFields,
): ReadonlyArray<StalePresetCorrection> {
  const profileId = device.profileId;
  if (profileId === undefined) return [];
  const preset = profileCatalogEntryById(profileId)?.profile;
  if (preset === undefined) return [];
  return PRESET_CORRECTIONS.filter(
    (correction) => correction.profileIds.includes(profileId) && correction.predates(device),
  ).map(({ before, now, effect, fields }) => ({
    presetName: preset.name,
    before,
    now,
    effect,
    patch: Object.fromEntries(fields.map((field) => [field, preset[field]])),
  }));
}
