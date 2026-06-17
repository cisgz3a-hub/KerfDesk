import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
  type NoGoZone,
  type ProfileCapability,
  type ProfileEvidence,
} from './device-profile';

export const PROFILE_CATALOG_VERSION = '2026-06-17';

export type MachineProfileCatalogEntry = {
  readonly profile: DeviceProfile;
  readonly evidence: ReadonlyArray<ProfileEvidence>;
  readonly reviewNotes: ReadonlyArray<string>;
};

const FALCON_COMPATIBLE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'creality-falcon-a1-pro-compatible',
  vendor: 'Creality',
  model: 'Falcon A1 Pro / Falcon-compatible',
  name: 'Creality Falcon A1 Pro / Falcon-compatible',
  machineFamily: 'creality-falcon',
  capabilities: ['grbl', 'wcs', 'air-assist', 'no-go-zones'],
  evidence: [
    {
      label: 'LaserForge default/Falcon parity',
      status: 'researched',
      note: 'Uses the legacy LaserForge default output behavior that previous Falcon-compatible burns verified.',
    },
  ],
};

export const GRBL_MACHINE_PROFILE_CATALOG: ReadonlyArray<MachineProfileCatalogEntry> = [
  entry(DEFAULT_DEVICE_PROFILE, [
    'Starter profile. Confirm work area, homing, and laser S range before first job.',
  ]),
  entry(FALCON_COMPATIBLE_PROFILE, [
    'Falcon-compatible output is kept byte-stable against existing LaserForge tests.',
  ]),
  entry(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, [
    'Conservative streaming and feed-controlled laser-off travel are intentional for this 4040 class.',
  ]),
];

export function profileCatalogEntryById(
  profileId: string,
): MachineProfileCatalogEntry | undefined {
  return GRBL_MACHINE_PROFILE_CATALOG.find((entry) => entry.profile.profileId === profileId);
}

export function profileSupportsCapability(
  profile: DeviceProfile,
  capability: ProfileCapability,
): boolean {
  return profile.capabilities?.includes(capability) === true;
}

export function duplicateProfileAsCustom(
  profile: DeviceProfile,
  options: { readonly profileId: string; readonly name: string },
): DeviceProfile {
  const base = profileWithoutCatalogVersion(profile);
  return {
    ...base,
    profileId: options.profileId,
    name: options.name,
    profileSource: 'custom',
    evidence: [
      {
        label: 'Custom profile',
        status: 'user-imported',
        note: `Duplicated from ${profile.profileId ?? profile.name}. Review machine settings before use.`,
      },
    ],
  };
}

function profileWithoutCatalogVersion(profile: DeviceProfile): DeviceProfile {
  const { catalogVersion, ...rest } = profile;
  if (catalogVersion === undefined) return rest;
  return rest;
}

export function validateMachineProfile(profile: DeviceProfile): ReadonlyArray<string> {
  const errors: string[] = [];
  requireNonEmpty(profile.name, 'name', errors);
  if (profile.profileId !== undefined) requireNonEmpty(profile.profileId, 'profileId', errors);
  if (profile.controllerKind !== undefined && profile.controllerKind !== 'grbl-v1.1') {
    errors.push('controllerKind must be grbl-v1.1');
  }
  requirePositive(profile.bedWidth, 'bedWidth', errors);
  requirePositive(profile.bedHeight, 'bedHeight', errors);
  requirePositive(profile.maxFeed, 'maxFeed', errors);
  requirePositive(profile.maxPowerS, 'maxPowerS', errors);
  requireNonNegative(profile.minPowerS, 'minPowerS', errors);
  requirePositive(profile.framingFeedMmPerMin, 'framingFeedMmPerMin', errors);
  if (profile.minPowerS > profile.maxPowerS) {
    errors.push('minPowerS must not exceed maxPowerS');
  }
  if (profile.noGoZones !== undefined && !Array.isArray(profile.noGoZones)) {
    errors.push('noGoZones must be an array');
  } else if (profile.noGoZones !== undefined) {
    for (const zone of profile.noGoZones) {
      appendNoGoZoneErrors(zone, errors);
    }
  }
  return errors;
}

function entry(
  profile: DeviceProfile,
  reviewNotes: ReadonlyArray<string>,
): MachineProfileCatalogEntry {
  return {
    profile: {
      ...profile,
      profileSource: 'built-in',
      catalogVersion: PROFILE_CATALOG_VERSION,
    },
    evidence: profile.evidence ?? [],
    reviewNotes,
  };
}

function appendNoGoZoneErrors(zone: NoGoZone, errors: string[]): void {
  requireNonEmpty(zone.id, 'noGoZones.id', errors);
  requireNonEmpty(zone.name, 'noGoZones.name', errors);
  requireNonNegative(zone.x, `noGoZones.${zone.id}.x`, errors);
  requireNonNegative(zone.y, `noGoZones.${zone.id}.y`, errors);
  requirePositive(zone.width, `noGoZones.${zone.id}.width`, errors);
  requirePositive(zone.height, `noGoZones.${zone.id}.height`, errors);
}

function requireNonEmpty(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function requirePositive(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    errors.push(`${field} must be positive`);
  }
}

function requireNonNegative(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${field} must be non-negative`);
  }
}
