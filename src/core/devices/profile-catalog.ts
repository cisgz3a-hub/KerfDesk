import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  isKnownControllerKind,
  type DeviceProfile,
  type LaserSubProfile,
  type NoGoZone,
  type ProfileCapability,
  type ProfileEvidence,
} from './device-profile';
import { isGrblRxBufferBytes, isGrblStreamingMode } from '../grbl-streaming';
import { validateCameraProfileShape } from '../camera';
import { isGcodeDialectSelection } from './gcode-dialects';
import { FALCON_A1_PRO_GRBLHAL_PROFILE, FALCON_COMPATIBLE_PROFILE } from './falcon-profiles';
import { isStreamingModeCompatible } from './controller-streaming-mode';

export const PROFILE_CATALOG_VERSION = '2026-06-17';

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

// Brand starter profiles. Bed dimensions are commonly-published figures, NOT
// hardware-verified here, so each carries public-spec starter evidence. The Device
// Setup wizard reads the true travel/power from the controller's $$ dump on
// connect (core/controllers/grbl/parse-settings.ts), so these are named
// starting points and an offline fallback; the operator confirms first.
const XTOOL_D1_PRO_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'xtool-d1-pro',
  vendor: 'xTool',
  model: 'D1 Pro',
  name: 'xTool D1 Pro',
  machineFamily: 'xtool-d1-pro',
  controllerKind: 'grbl-v1.1',
  bedWidth: 430,
  bedHeight: 390,
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'xTool D1 Pro public specs',
      status: 'public-spec-starter',
      note: 'Work area ~430×390 mm from published specs (xTool lists up to 432×406). Confirm bed size, S range, and homing — KerfDesk reads the real values from $$ on connect.',
    },
  ],
};

const SCULPFUN_S30_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'sculpfun-s30',
  vendor: 'Sculpfun',
  model: 'S30',
  name: 'Sculpfun S30',
  machineFamily: 'sculpfun-s30',
  controllerKind: 'grbl-v1.1',
  bedWidth: 410,
  bedHeight: 400,
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'Sculpfun S30 public specs',
      status: 'public-spec-starter',
      note: 'Work area ~410×400 mm from published specs (Pro/Max variants differ). Confirm bed size and S range before the first job; KerfDesk reads the real values from $$ on connect.',
    },
  ],
};

const ORTUR_LASER_MASTER_3_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'ortur-laser-master-3',
  vendor: 'Ortur',
  model: 'Laser Master 3',
  name: 'Ortur Laser Master 3',
  machineFamily: 'ortur-laser-master-3',
  controllerKind: 'grbl-v1.1',
  bedWidth: 400,
  bedHeight: 400,
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'Ortur Laser Master 3 public specs',
      status: 'public-spec-starter',
      note: 'Work area ~400×400 mm from published specs. Confirm bed size, homing, and S range before the first job; KerfDesk reads the real values from $$ on connect.',
    },
  ],
};

// Phase H controller-family starters. Wire-compatible with the GRBL driver
// path; the controllerKind selects the matching ControllerDriver at connect.
const GENERIC_GRBLHAL_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-grblhal',
  vendor: 'Generic',
  model: 'grblHAL controller',
  name: 'Generic grblHAL 400×400',
  machineFamily: 'generic-grblhal',
  controllerKind: 'grblhal',
  capabilities: ['grbl', 'wcs', 'verified-origin', 'scan-offsets', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'grblHAL protocol compatibility',
      status: 'simulator-tested',
      note: 'grblHAL speaks the GRBL v1.1 wire protocol with extended codes. Use a specific hardware profile when one matches; confirm bed size and S range from $$ on connect.',
    },
  ],
};

const GENERIC_FLUIDNC_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-fluidnc',
  vendor: 'Generic',
  model: 'FluidNC (ESP32)',
  name: 'Generic FluidNC 400×400',
  machineFamily: 'generic-fluidnc',
  controllerKind: 'fluidnc',
  capabilities: ['grbl', 'wcs', 'verified-origin', 'no-go-zones', 'rotary'],
  evidence: [
    {
      label: 'FluidNC GRBL-compatible reporting',
      status: 'simulator-tested',
      note: 'FluidNC reports as "Grbl 3.x [FluidNC vX]" and streams like GRBL, but real configuration lives in its YAML config — numeric $ writes are disabled in-app. Simulator-verified only; not hardware-verified.',
    },
  ],
};

const GENERIC_MARLIN_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-marlin-laser',
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
  capabilities: ['no-go-zones'],
  evidence: [
    {
      label: 'Marlin LASER_FEATURE conventions',
      status: 'simulator-tested',
      note: 'Marlin builds vary widely (LASER_FEATURE inline vs fan-mosfet wiring, S 0-255 vs 0-100). Simulator-verified only; NOT hardware-verified. Confirm the dialect and S range against your firmware configuration before burning.',
    },
  ],
};

const GENERIC_SMOOTHIEWARE_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-smoothieware',
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
  capabilities: ['wcs', 'no-go-zones'],
  evidence: [
    {
      label: 'Smoothieware laser module conventions',
      status: 'simulator-tested',
      note: 'Fractional S scale (0-1.0) from the Smoothieware laser docs; realtime ?/!/~ supported, halt recovery via M999. Simulator-verified only; NOT hardware-verified. Confirm laser_module_maximum_s_value against your config.',
    },
  ],
};

const GENERIC_RUIDA_PROFILE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  profileId: 'generic-ruida-rd-export',
  vendor: 'Generic',
  model: 'Ruida RDC644x-class CO2 (.rd export)',
  name: 'Generic Ruida CO2 900×600 (.rd export)',
  machineFamily: 'generic-ruida',
  controllerKind: 'ruida',
  bedWidth: 900,
  bedHeight: 600,
  origin: 'rear-right',
  capabilities: ['no-go-zones'],
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
    'Starter profile. Confirm work area, homing, and laser S range before first job.',
  ]),
  entry(FALCON_A1_PRO_GRBLHAL_PROFILE, [
    'Hardware-verified Falcon A1 Pro grblHAL identity. Confirm your controller $$ before cutting.',
  ]),
  entry(FALCON_COMPATIBLE_PROFILE, [
    'Broad Falcon-compatible GRBL fallback; use the grblHAL Falcon profile when detected.',
  ]),
  entry(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, [
    'No default 4040 scan-offset table is shipped; calibrate before enabling compensation.',
  ]),
  entry(XTOOL_D1_PRO_PROFILE, [
    'Work area from public specs; KerfDesk confirms the real bed size from $$ on connect.',
  ]),
  entry(SCULPFUN_S30_PROFILE, [
    'Work area from public specs; confirm bed size and S range before the first job.',
  ]),
  entry(ORTUR_LASER_MASTER_3_PROFILE, [
    'Work area from public specs; confirm bed size, homing, and S range before the first job.',
  ]),
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
    'Smoothieware: fractional S power (0-1.0), realtime ?/!/~, M999 halt recovery, no $$/$J.',
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
  if (profile.controllerKind !== undefined && !isKnownControllerKind(profile.controllerKind)) {
    errors.push(
      'controllerKind must be one of: grbl-v1.1, grblhal, fluidnc, marlin, smoothieware, ruida',
    );
  }
  if (!isGcodeDialectSelection(profile.gcodeDialect)) {
    errors.push('gcodeDialect must reference a known GRBL dialect');
  }
  if (!isGrblStreamingMode(profile.streamingMode)) {
    errors.push('streamingMode must be char-counted or ping-pong');
  } else if (!isStreamingModeCompatible(profile.controllerKind, profile.streamingMode)) {
    errors.push(`${profile.controllerKind} requires ping-pong streaming`);
  }
  if (!isGrblRxBufferBytes(profile.rxBufferBytes)) {
    errors.push('rxBufferBytes must be a positive integer not greater than 4096');
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
  appendLaserSubProfileErrors(profile.laserSubProfile, errors);
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
    catalogVersion: PROFILE_CATALOG_VERSION,
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
