import {
  isGcodeDialectSelection,
  isGrblRxBufferBytes,
  isGrblStreamingMode,
  isEstimateTimeScale,
  isKnownControllerKind,
  normalizeLaserFireControl,
  type LaserAirAssistHardware,
  type LaserFocusMode,
  type LaserHeadMetadataConfidence,
  type LaserTechnology,
  type MachineProfileSource,
  type Origin,
  PROFILE_CAPABILITIES,
  type ProfileCapability,
  type ProfileEvidenceStatus,
} from '../../core/devices';
import {
  normalizeCameraAlignment,
  normalizeCameraCalibration,
  validateCameraProfileShape,
} from '../../core/camera';

const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;
const PROFILE_SOURCES = ['built-in', 'custom', 'imported', 'lightburn'] as const;
const PROFILE_EVIDENCE_STATUSES = [
  'default-starter',
  'hardware-verified',
  'simulator-tested',
  'public-spec-starter',
  'experimental',
  'user-imported',
  // Legacy statuses accepted for older project/profile documents.
  'default',
  'researched',
  'unverified',
] as const;
const LASER_FOCUS_MODES = ['fixed-lever', 'manual', 'unknown'] as const;
const LASER_AIR_ASSIST_HARDWARE = ['built-in', 'manual', 'none', 'unknown'] as const;
const LASER_TECHNOLOGIES = ['diode', 'co2', 'fiber', 'unknown'] as const;
const LASER_HEAD_METADATA_CONFIDENCES = [
  'researched',
  'user-confirmed',
  'imported',
  'unverified',
] as const;

export function validateMachineProfileShape(value: Record<string, unknown>): string | null {
  return (
    validateProfileIdentity(value) ??
    validateProfileMachineFields(value) ??
    validateProfileHoming(value['homing']) ??
    validateProfileOptionalZ(value) ??
    validateProfileCapabilities(value['capabilities']) ??
    validateProfileEvidence(value['evidence']) ??
    validateLaserSubProfile(value['laserSubProfile']) ??
    validateCameraProfile(value['cameraProfile']) ??
    validateCameraCalibration(value['cameraCalibration']) ??
    validateCameraAlignment(value['cameraAlignment']) ??
    validateLaserFireControl(value['fireControl'])
  );
}

function validateProfileIdentity(value: Record<string, unknown>): string | null {
  if (!isNonEmptyString(value['name'])) return 'profile.name must be a non-empty string';
  if (value['profileId'] !== undefined && !isNonEmptyString(value['profileId'])) {
    return 'profile.profileId must be a non-empty string';
  }
  for (const field of ['vendor', 'model', 'catalogVersion', 'machineFamily'] as const) {
    if (value[field] !== undefined && !isNonEmptyString(value[field])) {
      return `profile.${field} must be a non-empty string`;
    }
  }
  if (value['profileSource'] !== undefined && !isProfileSource(value['profileSource'])) {
    return 'profile.profileSource is invalid';
  }
  if (value['controllerKind'] !== undefined && !isKnownControllerKind(value['controllerKind'])) {
    return 'profile.controllerKind is invalid';
  }
  return null;
}

function validateProfileMachineFields(value: Record<string, unknown>): string | null {
  return (
    validateProfileStreamingFields(value) ??
    validateProfilePositiveMachineFields(value) ??
    validateProfileScalarMachineFields(value)
  );
}

function validateProfileStreamingFields(value: Record<string, unknown>): string | null {
  if (!isGcodeDialectSelection(value['gcodeDialect'])) return 'profile.gcodeDialect is invalid';
  if (
    value['baudRate'] !== undefined &&
    (!Number.isInteger(value['baudRate']) || !isPositiveFinite(value['baudRate']))
  ) {
    return 'profile.baudRate must be a positive integer';
  }
  if (value['streamingMode'] !== undefined && !isGrblStreamingMode(value['streamingMode'])) {
    return 'profile.streamingMode is invalid';
  }
  if (value['rxBufferBytes'] !== undefined && !isGrblRxBufferBytes(value['rxBufferBytes'])) {
    return 'profile.rxBufferBytes is invalid';
  }
  return null;
}

function validateProfilePositiveMachineFields(value: Record<string, unknown>): string | null {
  for (const field of [
    'bedWidth',
    'bedHeight',
    'maxFeed',
    'maxPowerS',
    'framingFeedMmPerMin',
    'accelMmPerSec2',
  ] as const) {
    if (!isPositiveFinite(value[field])) return `profile.${field} must be positive`;
  }
  return null;
}

function validateProfileScalarMachineFields(value: Record<string, unknown>): string | null {
  if (!isNonNegativeFinite(value['minPowerS'])) return 'profile.minPowerS must be non-negative';
  if (!isNonNegativeFinite(value['junctionDeviationMm'])) {
    return 'profile.junctionDeviationMm must be non-negative';
  }
  for (const field of ['estimateCutTimeScale', 'estimateTravelTimeScale'] as const) {
    if (value[field] !== undefined && !isEstimateTimeScale(value[field])) {
      return `profile.${field} must be between 0.1 and 5`;
    }
  }
  if (typeof value['laserModeEnabled'] !== 'boolean') {
    return 'profile.laserModeEnabled must be a boolean';
  }
  if (!isAirAssistCommand(value['airAssistCommand'])) return 'profile.airAssistCommand is invalid';
  if (!isOrigin(value['origin'])) return 'profile.origin is invalid';
  if (typeof value['autofocusCommand'] !== 'string') {
    return 'profile.autofocusCommand must be a string';
  }
  return null;
}

function validateProfileHoming(value: unknown): string | null {
  if (!isRecord(value)) return 'profile.homing is invalid';
  if (typeof value['enabled'] !== 'boolean' || !isOrigin(value['direction'])) {
    return 'profile.homing is invalid';
  }
  return null;
}

function validateProfileOptionalZ(value: Record<string, unknown>): string | null {
  if (value['zTravelMm'] !== undefined && !isPositiveFinite(value['zTravelMm'])) {
    return 'profile.zTravelMm must be positive';
  }
  for (const field of ['zTravelConfirmed', 'zProbePresent'] as const) {
    if (value[field] !== undefined && typeof value[field] !== 'boolean') {
      return `profile.${field} must be a boolean`;
    }
  }
  return null;
}

function validateProfileCapabilities(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.some((item) => !isProfileCapability(item))) {
    return 'profile.capabilities is invalid';
  }
  return null;
}

function validateProfileEvidence(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return 'profile.evidence is invalid';
  for (const item of value) {
    if (!isRecord(item)) return 'profile.evidence is invalid';
    if (
      !isNonEmptyString(item['label']) ||
      !isProfileEvidenceStatus(item['status']) ||
      !isNonEmptyString(item['note'])
    ) {
      return 'profile.evidence is invalid';
    }
  }
  return null;
}

function validateLaserSubProfile(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return 'profile.laserSubProfile is invalid';
  return (
    validateLaserSubProfileIdentity(value) ??
    validateLaserSubProfileNumbers(value) ??
    validateLaserSubProfileNotes(value) ??
    validateLaserSpotSize(value['spotSizeMm'])
  );
}

function validateCameraProfile(value: unknown): string | null {
  if (value === undefined) return null;
  return validateCameraProfileShape(value, 'profile.cameraProfile');
}

function validateCameraCalibration(value: unknown): string | null {
  if (value === undefined) return null;
  return normalizeCameraCalibration(value) === undefined
    ? 'profile.cameraCalibration is invalid'
    : null;
}

function validateCameraAlignment(value: unknown): string | null {
  if (value === undefined) return null;
  return normalizeCameraAlignment(value) === undefined
    ? 'profile.cameraAlignment is invalid'
    : null;
}

function validateLaserFireControl(value: unknown): string | null {
  if (value === undefined) return null;
  return normalizeLaserFireControl(value) === undefined ? 'profile.fireControl is invalid' : null;
}

function validateLaserSubProfileIdentity(value: Record<string, unknown>): string | null {
  if (!isNonEmptyString(value['model'])) return 'profile.laserSubProfile is invalid';
  if (!isLaserFocusMode(value['focusMode'])) return 'profile.laserSubProfile is invalid';
  if (!isLaserAirAssistHardware(value['airAssist'])) return 'profile.laserSubProfile is invalid';
  if (value['technology'] !== undefined && !isLaserTechnology(value['technology'])) {
    return 'profile.laserSubProfile is invalid';
  }
  if (
    value['metadataConfidence'] !== undefined &&
    !isLaserHeadMetadataConfidence(value['metadataConfidence'])
  ) {
    return 'profile.laserSubProfile is invalid';
  }
  return null;
}

function validateLaserSubProfileNumbers(value: Record<string, unknown>): string | null {
  for (const field of ['opticalPowerW', 'wavelengthNm', 'focusLengthMm'] as const) {
    if (value[field] !== undefined && !isPositiveFinite(value[field])) {
      return 'profile.laserSubProfile is invalid';
    }
  }
  return null;
}

function validateLaserSubProfileNotes(value: Record<string, unknown>): string | null {
  if (value['notes'] !== undefined && typeof value['notes'] !== 'string') {
    return 'profile.laserSubProfile is invalid';
  }
  return null;
}

function validateLaserSpotSize(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value) || !isPositiveFinite(value['x']) || !isPositiveFinite(value['y'])) {
    return 'profile.laserSubProfile is invalid';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isProfileSource(value: unknown): value is MachineProfileSource {
  return PROFILE_SOURCES.some((source) => source === value);
}

function isProfileCapability(value: unknown): value is ProfileCapability {
  return PROFILE_CAPABILITIES.some((capability) => capability === value);
}

function isProfileEvidenceStatus(value: unknown): value is ProfileEvidenceStatus {
  return PROFILE_EVIDENCE_STATUSES.some((status) => status === value);
}

function isLaserFocusMode(value: unknown): value is LaserFocusMode {
  return LASER_FOCUS_MODES.some((mode) => mode === value);
}

function isLaserAirAssistHardware(value: unknown): value is LaserAirAssistHardware {
  return LASER_AIR_ASSIST_HARDWARE.some((hardware) => hardware === value);
}

function isLaserTechnology(value: unknown): value is LaserTechnology {
  return LASER_TECHNOLOGIES.some((technology) => technology === value);
}

function isLaserHeadMetadataConfidence(value: unknown): value is LaserHeadMetadataConfidence {
  return LASER_HEAD_METADATA_CONFIDENCES.some((confidence) => confidence === value);
}

function isOrigin(value: unknown): value is Origin {
  return ORIGINS.some((origin) => origin === value);
}

function isAirAssistCommand(value: unknown): boolean {
  return value === 'none' || value === 'M7' || value === 'M8';
}
