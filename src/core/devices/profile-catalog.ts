import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
  type LaserSubProfile,
  type NoGoZone,
  type ProfileCapability,
  type ProfileEvidence,
} from './device-profile';
import { validateCameraProfileShape } from '../camera';
import { GRBLHAL_DEFAULT_RX_BUFFER_BYTES } from '../grbl-streaming';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { validateScanOffsetProfile } from './scan-offset-profile';
import { cncSubProfileIssues } from './cnc-sub-profile-validation';
import { machineProfileControllerIssues } from './machine-profile-controller-validation';
import {
  XTOOL_D1_PRO_PROFILES,
  SCULPFUN_S30_PROFILE,
  SCULPFUN_S30_MANUAL_AIR_PROFILE,
  ORTUR_LASER_MASTER_3_PROFILES,
} from './brand-laser-profiles';

export const PROFILE_CATALOG_VERSION = '2026-09-19';

const LASER_TECHNOLOGIES: ReadonlyArray<NonNullable<LaserSubProfile['technology']>> = [
  'diode',
  'co2',
  'fiber',
  'unknown',
];
const LASER_HEAD_METADATA_CONFIDENCES: ReadonlyArray<
  NonNullable<LaserSubProfile['metadataConfidence']>
> = ['researched', 'user-confirmed', 'imported', 'unverified'];

export type MachineProfileCatalogEntry = {
  readonly profile: DeviceProfile;
  readonly evidence: ReadonlyArray<ProfileEvidence>;
  readonly reviewNotes: ReadonlyArray<string>;
};

// Phase H controller-family starters. Wire-compatible with the GRBL driver
// path; the controllerKind selects the matching ControllerDriver at connect.
const GENERIC_GRBLHAL_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-grblhal',
  catalogVersion: PROFILE_CATALOG_VERSION,
  vendor: 'Generic',
  model: 'grblHAL controller',
  name: 'Generic grblHAL 400×400',
  machineFamily: 'generic-grblhal',
  controllerKind: 'grblhal',
  // grblHAL core defaults to a 1024-byte receive ring (stream.h); the window
  // is still bounded at Start by the controller's own `Bf:` report (ADR-331).
  rxBufferBytes: GRBLHAL_DEFAULT_RX_BUFFER_BYTES,
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'grblHAL protocol compatibility',
      status: 'simulator-tested',
      note: 'Firmware template with unspecified machine output kind. GRBL-compatible serial commands have simulator coverage; board plugins and spindle/laser configuration vary. Match the controller-reported configured travel and S range, then confirm usable work area. Source checked 2026-09-19: https://github.com/grblHAL/core . No hardware qualification.',
    },
  ],
};

const GENERIC_FLUIDNC_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-fluidnc',
  catalogVersion: PROFILE_CATALOG_VERSION,
  vendor: 'Generic',
  model: 'FluidNC (ESP32)',
  name: 'Generic FluidNC 400×400',
  machineFamily: 'generic-fluidnc',
  controllerKind: 'fluidnc',
  // FluidNC v4.0.3 LaserSpindle.cpp default speed_map. Saved profiles and live
  // reports retain their configured scale; a YAML speed_map can override it.
  maxPowerS: 255,
  capabilities: ['grbl', 'wcs', 'verified-origin', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'FluidNC GRBL-compatible reporting',
      status: 'simulator-tested',
      note: 'Firmware template with unspecified machine output kind. Serial GRBL-compatible reporting and streaming have simulator coverage; Wi-Fi is not implemented by this profile. Match the YAML laser speed_map: 255 is the FluidNC v4.0.3 laser default, not a universal S maximum. Numeric $ writes are disabled in-app. Source checked 2026-09-19: https://github.com/bdring/FluidNC/blob/v4.0.3/FluidNC/src/Spindles/LaserSpindle.cpp. No hardware qualification.',
    },
  ],
};

const GENERIC_MARLIN_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-marlin-laser',
  catalogVersion: PROFILE_CATALOG_VERSION,
  vendor: 'Generic',
  model: 'Marlin laser (LASER_FEATURE)',
  name: 'Generic Marlin laser 300×200',
  machineFamily: 'generic-marlin',
  controllerKind: 'marlin',
  baudRate: 250000,
  // Marlin has no realtime buffer reporting; ping-pong (one line per ok) is
  // the only safe streaming mode.
  streamingMode: 'ping-pong',
  gcodeDialect: { dialectId: 'marlin-inline' },
  bedWidth: 300,
  bedHeight: 200,
  // Marlin laser convention: S range 0-255.
  maxPowerS: 255,
  minPowerS: 0,
  capabilities: ['laser-output', 'no-go-zones'],
  evidence: [
    {
      label: 'Marlin LASER_FEATURE conventions',
      status: 'simulator-tested',
      note: 'Inline output targets Marlin 2.1.2.6 LASER_FEATURE with PWM and M3 I continuous inline power; CUTTER_POWER_UNIT must match the selected S range (this starter uses 255). LASER_POWER_TRAP is a firmware build choice. Origin reset requires CNC_COORDINATE_SYSTEMS and a non-SCARA build. Fan-MOSFET wiring requires the separate fan dialect. Match baud and firmware configuration. Source: https://marlinfw.org/docs/gcode/M003.html. Simulator coverage only; no hardware qualification.',
    },
  ],
};

const GENERIC_SMOOTHIEWARE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-smoothieware',
  catalogVersion: PROFILE_CATALOG_VERSION,
  vendor: 'Generic',
  model: 'Smoothieware laser',
  name: 'Generic Smoothieware 300×200',
  machineFamily: 'generic-smoothieware',
  controllerKind: 'smoothieware',
  streamingMode: 'ping-pong',
  bedWidth: 300,
  bedHeight: 200,
  // Smoothie's laser module scales S against laser_module_maximum_s_value,
  // default 1.0 — power words are fractions (S0.500 = 50%).
  maxPowerS: 1,
  minPowerS: 0,
  capabilities: ['laser-output', 'wcs', 'no-go-zones'],
  evidence: [
    {
      label: 'Smoothieware laser module conventions',
      status: 'simulator-tested',
      note: 'Smoothieware V1 laser module: match laser_module_maximum_s_value (default 1.0) and set laser_module_minimum_power to 0 so S0 feed moves remain dark. Power mode uses M221 P, not GRBL M3/M4. Status uses ?, halt recovery uses M999; realtime pause/resume is not offered because transport/configuration support varies. Source checked 2026-09-19: https://smoothieware.org/laser.html. Simulator coverage only; no hardware qualification.',
    },
  ],
};

const GENERIC_RUIDA_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-ruida-rd-export',
  catalogVersion: PROFILE_CATALOG_VERSION,
  vendor: 'Generic',
  model: 'Ruida RDC644x-class CO2 (.rd export)',
  name: 'Generic Ruida CO2 900×600 (.rd export)',
  machineFamily: 'generic-ruida',
  controllerKind: 'ruida',
  bedWidth: 900,
  bedHeight: 600,
  origin: 'rear-right',
  capabilities: ['laser-output', 'no-go-zones'],
  evidence: [
    {
      label: 'Ruida protocol (public reverse-engineering)',
      status: 'experimental',
      note: 'EXPERIMENTAL: .rd encoding follows public research (MeerK40t / EduTech). Output round-trips through this app’s own decoder, but NO file has been accepted by a real Ruida controller yet. Live streaming is not available — export .rd and run from the panel/USB. Verify on scrap with the machine’s own preview first.',
    },
  ],
};

export const GRBL_MACHINE_PROFILE_CATALOG: ReadonlyArray<MachineProfileCatalogEntry> = [
  entry(DEFAULT_DEVICE_PROFILE, [
    'Generic firmware template; the machine and laser/CNC output kind are unspecified. Confirm usable work area, homing and S scale.',
  ]),
  entry(FALCON_A1_PRO_GRBLHAL_PROFILE, [
    'Manufacturer configuration starter; controller build and physical operation are not qualified. Use the researched model-specific dimensions and commands.',
  ]),
  entry(FALCON_COMPATIBLE_PROFILE, [
    'Broad Falcon-compatible GRBL fallback. Choose the A1 Pro profile only for that model; a firmware banner does not identify the machine.',
  ]),
  entry(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, [
    'No default 4040 scan-offset table is shipped; calibrate before enabling compensation.',
  ]),
  ...XTOOL_D1_PRO_PROFILES.map((profile) =>
    entry(profile, [
      'Choose the fitted laser head. Controller-reported configured travel does not verify head clearance or usable work area.',
    ]),
  ),
  entry(SCULPFUN_S30_PROFILE, [
    'Stock S30 5 W pump uses M8/M9. Confirm the installed pump, usable work area, S range and homing configuration.',
  ]),
  entry(SCULPFUN_S30_MANUAL_AIR_PROFILE, [
    'Manual pump variant; no software air command is sent. Stock automatic pumps use the separate M8 profile.',
  ]),
  ...ORTUR_LASER_MASTER_3_PROFILES.map((profile) =>
    entry(profile, [
      'Match the LU2/LU3 head. Controller-reported configured travel is not a physical measurement.',
    ]),
  ),
  entry(GENERIC_GRBLHAL_PROFILE, [
    'grblHAL is wire-compatible with the GRBL driver; extended alarm codes 11-13 are decoded.',
  ]),
  entry(GENERIC_FLUIDNC_PROFILE, [
    'FluidNC numeric $ setting writes are blocked in-app (configuration lives in its YAML config).',
  ]),
  entry(GENERIC_MARLIN_PROFILE, [
    'Marlin: ping-pong streaming, no realtime pause/stop bytes, S 0-255, dialect must match the firmware build (inline vs fan).',
  ]),
  entry(GENERIC_SMOOTHIEWARE_PROFILE, [
    'Smoothieware V1: fractional S, M221 P power mode, ? status and M999 halt recovery. No realtime pause/resume, $$ or $J in this integration.',
  ]),
  entry(GENERIC_RUIDA_PROFILE, [
    'Ruida: file-export only (.rd); encoder is EXPERIMENTAL and not accepted by real hardware yet.',
  ]),
];

export function profileCatalogEntryById(profileId: string): MachineProfileCatalogEntry | undefined {
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
  const { catalogVersion, ...base } = profile;
  void catalogVersion;
  return {
    ...base,
    profileId: options.profileId,
    name: options.name,
    profileSource: 'custom',
    evidence: [
      {
        label: 'Custom profile',
        status: 'user-imported',
        note: `Duplicated from ${profile.profileId ?? profile.name}. Review before use.`,
      },
    ],
  };
}

export function validateMachineProfile(profile: DeviceProfile): ReadonlyArray<string> {
  const errors: string[] = [];
  requireNonEmpty(profile.name, 'name', errors);
  if (profile.profileId !== undefined) requireNonEmpty(profile.profileId, 'profileId', errors);
  errors.push(...machineProfileControllerIssues(profile));
  requirePositive(profile.bedWidth, 'bedWidth', errors);
  requirePositive(profile.bedHeight, 'bedHeight', errors);
  requirePositive(profile.maxFeed, 'maxFeed', errors);
  requirePositive(profile.maxPowerS, 'maxPowerS', errors);
  requireNonNegative(profile.minPowerS, 'minPowerS', errors);
  requirePositive(profile.framingFeedMmPerMin, 'framingFeedMmPerMin', errors);
  if (profile.controlledLaserOffTravelFeedMmPerMin !== undefined) {
    requirePositive(
      profile.controlledLaserOffTravelFeedMmPerMin,
      'controlledLaserOffTravelFeedMmPerMin',
      errors,
    );
    if (profile.controlledLaserOffTravelFeedMmPerMin > profile.maxFeed) {
      errors.push('controlledLaserOffTravelFeedMmPerMin must not exceed maxFeed');
    }
  }
  if (profile.minPowerS > profile.maxPowerS) {
    errors.push('minPowerS must not exceed maxPowerS');
  }
  errors.push(...validateScanOffsetProfile(profile));
  appendLaserSubProfileErrors(profile.laserSubProfile, errors);
  errors.push(...cncSubProfileIssues(profile.cncSubProfile));
  appendCameraCapabilityErrors(profile, errors);
  appendCameraProfileErrors(profile.cameraProfile, errors);
  for (const zone of profile.noGoZones) appendNoGoZoneErrors(zone, errors);
  return errors;
}

function entry(
  profile: DeviceProfile,
  reviewNotes: ReadonlyArray<string>,
): MachineProfileCatalogEntry {
  const builtInProfile = {
    ...profile,
    profileSource: 'built-in' as const,
    // A profile revised after the catalog baseline keeps its own version date
    // instead of losing its provenance; the catalog constant is the fallback so
    // unrevised profiles still carry a provenance date.
    catalogVersion: profile.catalogVersion ?? PROFILE_CATALOG_VERSION,
  };
  return {
    profile: builtInProfile,
    evidence: builtInProfile.evidence ?? [],
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

function appendLaserSubProfileErrors(
  laserSubProfile: LaserSubProfile | undefined,
  errors: string[],
): void {
  if (laserSubProfile === undefined) return;
  requireNonEmpty(laserSubProfile.model, 'laserSubProfile.model', errors);
  if (
    laserSubProfile.technology !== undefined &&
    !LASER_TECHNOLOGIES.includes(laserSubProfile.technology)
  ) {
    errors.push('laserSubProfile.technology is invalid');
  }
  if (
    laserSubProfile.metadataConfidence !== undefined &&
    !LASER_HEAD_METADATA_CONFIDENCES.includes(laserSubProfile.metadataConfidence)
  ) {
    errors.push('laserSubProfile.metadataConfidence is invalid');
  }
  if (laserSubProfile.opticalPowerW !== undefined) {
    requirePositive(laserSubProfile.opticalPowerW, 'laserSubProfile.opticalPowerW', errors);
  }
  if (laserSubProfile.wavelengthNm !== undefined) {
    requirePositive(laserSubProfile.wavelengthNm, 'laserSubProfile.wavelengthNm', errors);
  }
  if (laserSubProfile.focusLengthMm !== undefined) {
    requirePositive(laserSubProfile.focusLengthMm, 'laserSubProfile.focusLengthMm', errors);
  }
  if (laserSubProfile.spotSizeMm !== undefined) {
    requirePositive(laserSubProfile.spotSizeMm.x, 'laserSubProfile.spotSizeMm.x', errors);
    requirePositive(laserSubProfile.spotSizeMm.y, 'laserSubProfile.spotSizeMm.y', errors);
  }
}

function appendCameraProfileErrors(
  cameraProfile: DeviceProfile['cameraProfile'] | undefined,
  errors: string[],
): void {
  if (cameraProfile === undefined) return;
  const error = validateCameraProfileShape(cameraProfile, 'cameraProfile');
  if (error !== null) errors.push('cameraProfile is invalid');
}

function appendCameraCapabilityErrors(profile: DeviceProfile, errors: string[]): void {
  const hasCameraCapability = profile.capabilities?.includes('camera') === true;
  if (hasCameraCapability && profile.cameraProfile === undefined) {
    errors.push('camera capability requires cameraProfile');
  }
  if (!hasCameraCapability && profile.cameraProfile !== undefined) {
    errors.push('cameraProfile requires camera capability');
  }
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
