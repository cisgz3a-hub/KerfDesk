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

type CorrectableFields = Pick<
  DeviceProfile,
  'origin' | 'bedWidth' | 'bedHeight' | 'homing' | 'kinematics'
>;

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
  // #796, 2026-09-19. From 2026-07-07 the A1 Pro preset carried the generic
  // 400 x 400 mm bed; Creality's LightBurn bundle gives Width 358, Height 268
  // (controller audit v2 C7-P2-1, ADR-660).
  {
    profileIds: ['creality-falcon-a1-pro-grblhal'],
    before: 'bed 400 x 400 mm',
    now: '358 x 268 mm',
    effect: 'a job near the edge can run past the real travel',
    fields: ['bedWidth', 'bedHeight'],
    predates: (device) => device.bedWidth === 400 && device.bedHeight === 400,
  },
  // 2026-10-28, rolling audit v6 K3-P2-1. The A1 Pro preset inherited homing
  // off, but both published A1 Pro $$ reads give $22=43 (homing on) and
  // $23=3 (front left), and Creality homes before every job (ADR-322
  // Amendment 3). Without homing its bed frame never applies.
  {
    profileIds: ['creality-falcon-a1-pro-grblhal'],
    before: 'homing off',
    now: 'homing on at the front left',
    effect:
      'Home is offered as "Set up homing", and Start checks only the job size, refuses every no-go zone and sets no jog limits',
    fields: ['homing'],
    predates: (device) => !device.homing.enabled,
  },
  // 2026-10-28, rolling audit v6 K3-P2-2. Both A1 Pro $I reads give
  // [KINEMATICS:CoreXY v2.02]; a copy saved before has no kinematics, which
  // reads as Cartesian (ADR-675).
  {
    profileIds: ['creality-falcon-a1-pro-grblhal'],
    before: 'the Cartesian motion model',
    now: 'CoreXY motion',
    effect:
      'Automatic overscan gives a diagonal scan too short a runway when acceleration is the firmware value, and estimates run short',
    fields: ['kinematics'],
    predates: (device) => device.kinematics === undefined,
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

export type WithdrawnPresetCopy = {
  readonly presetName: string;
  /** Why Machine Setup no longer lists the preset. */
  readonly reason: string;
};

/**
 * A saved copy of a preset Machine Setup no longer lists that still has the
 * preset's work area; null for any other profile. A withdrawn preset has no
 * corrected value to offer, and a work area the operator set is their own
 * (ADR-660).
 */
export function withdrawnPresetCopy(
  device: Pick<DeviceProfile, 'profileId' | 'bedWidth' | 'bedHeight'>,
): WithdrawnPresetCopy | null {
  if (device.profileId === undefined) return null;
  const entry = profileCatalogEntryById(device.profileId);
  if (entry?.withdrawn === undefined) return null;
  const preset = entry.profile;
  if (device.bedWidth !== preset.bedWidth || device.bedHeight !== preset.bedHeight) return null;
  return { presetName: preset.name, reason: entry.withdrawn };
}
