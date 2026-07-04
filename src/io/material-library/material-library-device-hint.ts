import {
  isGrblRxBufferBytes,
  isGrblStreamingMode,
  isScanOffsetTable,
  normalizeGrblRxBufferBytes,
  normalizeGrblStreamingMode,
  normalizeScanOffsetTable,
  type DeviceProfile,
  type LaserSubProfile,
  type Origin,
  type ScanOffsetPoint,
} from '../../core/devices';

export type MaterialLibraryDeviceHint = {
  readonly name: string;
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly maxFeed: number;
  readonly maxPowerS: number;
  readonly minPowerS: number;
  readonly laserModeEnabled: boolean;
  readonly airAssistCommand: DeviceProfile['airAssistCommand'];
  readonly streamingMode: DeviceProfile['streamingMode'];
  readonly rxBufferBytes: number;
  readonly origin: Origin;
  readonly scanningOffsets: ReadonlyArray<ScanOffsetPoint>;
  readonly laserSubProfile?: LaserSubProfile;
};

type MaterialLibraryDeviceHintInput = Omit<
  MaterialLibraryDeviceHint,
  'airAssistCommand' | 'streamingMode' | 'rxBufferBytes' | 'scanningOffsets'
> & {
  readonly airAssistCommand?: DeviceProfile['airAssistCommand'];
  readonly streamingMode?: DeviceProfile['streamingMode'];
  readonly rxBufferBytes?: number;
  readonly scanningOffsets?: ReadonlyArray<ScanOffsetPoint>;
  readonly laserSubProfile?: LaserSubProfile;
};

const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;
const LASER_FOCUS_MODES: ReadonlyArray<LaserSubProfile['focusMode']> = [
  'fixed-lever',
  'manual',
  'unknown',
];
const LASER_AIR_ASSIST_HARDWARE: ReadonlyArray<LaserSubProfile['airAssist']> = [
  'built-in',
  'manual',
  'none',
  'unknown',
];
const LASER_TECHNOLOGIES: ReadonlyArray<NonNullable<LaserSubProfile['technology']>> = [
  'diode',
  'co2',
  'fiber',
  'unknown',
];
const LASER_HEAD_METADATA_CONFIDENCES: ReadonlyArray<
  NonNullable<LaserSubProfile['metadataConfidence']>
> = ['researched', 'user-confirmed', 'imported', 'unverified'];

export function createMaterialLibraryDeviceHint(device: DeviceProfile): MaterialLibraryDeviceHint {
  return {
    name: device.name,
    bedWidth: device.bedWidth,
    bedHeight: device.bedHeight,
    maxFeed: device.maxFeed,
    maxPowerS: device.maxPowerS,
    minPowerS: device.minPowerS,
    laserModeEnabled: device.laserModeEnabled,
    airAssistCommand: device.airAssistCommand,
    streamingMode: device.streamingMode,
    rxBufferBytes: device.rxBufferBytes,
    origin: device.origin,
    scanningOffsets: normalizeScanOffsetTable(device.scanningOffsets),
    ...(device.laserSubProfile !== undefined
      ? { laserSubProfile: canonicalLaserSubProfile(device.laserSubProfile) }
      : {}),
  };
}

export function parseOptionalDeviceHint(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly deviceHint?: MaterialLibraryDeviceHint }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (value === undefined) {
    return { kind: 'ok' };
  }
  if (!isRecord(value)) {
    return { kind: 'invalid', reason: 'deviceHint must be an object' };
  }
  if (!isDeviceHint(value)) {
    return { kind: 'invalid', reason: 'deviceHint has invalid fields' };
  }
  return { kind: 'ok', deviceHint: canonicalDeviceHint(value) };
}

export function canonicalDeviceHint(
  deviceHint: MaterialLibraryDeviceHintInput,
): MaterialLibraryDeviceHint {
  return {
    name: deviceHint.name,
    bedWidth: deviceHint.bedWidth,
    bedHeight: deviceHint.bedHeight,
    maxFeed: deviceHint.maxFeed,
    maxPowerS: deviceHint.maxPowerS,
    minPowerS: deviceHint.minPowerS,
    laserModeEnabled: deviceHint.laserModeEnabled,
    airAssistCommand: deviceHint.airAssistCommand ?? 'none',
    streamingMode: normalizeGrblStreamingMode(deviceHint.streamingMode),
    rxBufferBytes: normalizeGrblRxBufferBytes(deviceHint.rxBufferBytes),
    origin: deviceHint.origin,
    scanningOffsets: normalizeScanOffsetTable(deviceHint.scanningOffsets),
    ...(deviceHint.laserSubProfile !== undefined
      ? { laserSubProfile: canonicalLaserSubProfile(deviceHint.laserSubProfile) }
      : {}),
  };
}

function isDeviceHint(value: Record<string, unknown>): value is MaterialLibraryDeviceHintInput {
  return hasRequiredDeviceHintFields(value) && hasOptionalDeviceHintFields(value);
}

function hasRequiredDeviceHintFields(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.name) &&
    isPositiveFinite(value.bedWidth) &&
    isPositiveFinite(value.bedHeight) &&
    isPositiveFinite(value.maxFeed) &&
    isPositiveFinite(value.maxPowerS) &&
    isNonNegativeFinite(value.minPowerS) &&
    typeof value.laserModeEnabled === 'boolean' &&
    isOrigin(value.origin)
  );
}

function hasOptionalDeviceHintFields(value: Record<string, unknown>): boolean {
  return (
    (value.airAssistCommand === undefined || isAirAssistCommand(value.airAssistCommand)) &&
    (value.streamingMode === undefined || isGrblStreamingMode(value.streamingMode)) &&
    (value.rxBufferBytes === undefined || isGrblRxBufferBytes(value.rxBufferBytes)) &&
    (value.scanningOffsets === undefined || isScanOffsetTable(value.scanningOffsets)) &&
    (value.laserSubProfile === undefined || isLaserSubProfile(value.laserSubProfile))
  );
}

function canonicalLaserSubProfile(laserSubProfile: LaserSubProfile): LaserSubProfile {
  return {
    model: laserSubProfile.model,
    ...(laserSubProfile.technology !== undefined ? { technology: laserSubProfile.technology } : {}),
    ...(laserSubProfile.metadataConfidence !== undefined
      ? { metadataConfidence: laserSubProfile.metadataConfidence }
      : {}),
    ...(laserSubProfile.opticalPowerW !== undefined
      ? { opticalPowerW: laserSubProfile.opticalPowerW }
      : {}),
    ...(laserSubProfile.wavelengthNm !== undefined
      ? { wavelengthNm: laserSubProfile.wavelengthNm }
      : {}),
    ...(laserSubProfile.spotSizeMm !== undefined
      ? { spotSizeMm: { ...laserSubProfile.spotSizeMm } }
      : {}),
    ...(laserSubProfile.focusLengthMm !== undefined
      ? { focusLengthMm: laserSubProfile.focusLengthMm }
      : {}),
    focusMode: laserSubProfile.focusMode,
    airAssist: laserSubProfile.airAssist,
    ...(laserSubProfile.notes !== undefined ? { notes: laserSubProfile.notes } : {}),
  };
}

function isLaserSubProfile(value: unknown): value is LaserSubProfile {
  if (!isRecord(value)) return false;
  return (
    hasLaserSubProfileIdentity(value) &&
    hasLaserSubProfileNumbers(value) &&
    hasLaserSubProfileNotes(value) &&
    isLaserSpotSize(value.spotSizeMm)
  );
}

function hasLaserSubProfileIdentity(value: Record<string, unknown>): boolean {
  if (!isNonEmptyString(value.model)) return false;
  if (!isLaserFocusMode(value.focusMode)) return false;
  if (!isLaserAirAssistHardware(value.airAssist)) return false;
  if (value.technology !== undefined && !isLaserTechnology(value.technology)) return false;
  if (
    value.metadataConfidence !== undefined &&
    !isLaserHeadMetadataConfidence(value.metadataConfidence)
  ) {
    return false;
  }
  return true;
}

function hasLaserSubProfileNumbers(value: Record<string, unknown>): boolean {
  for (const field of ['opticalPowerW', 'wavelengthNm', 'focusLengthMm'] as const) {
    if (value[field] !== undefined && !isPositiveFinite(value[field])) return false;
  }
  return true;
}

function hasLaserSubProfileNotes(value: Record<string, unknown>): boolean {
  if (value.notes !== undefined && typeof value.notes !== 'string') return false;
  return true;
}

function isLaserSpotSize(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && isPositiveFinite(value.x) && isPositiveFinite(value.y))
  );
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

function isOrigin(value: unknown): value is Origin {
  return ORIGINS.some((origin) => origin === value);
}

function isAirAssistCommand(value: unknown): value is DeviceProfile['airAssistCommand'] {
  return value === 'none' || value === 'M7' || value === 'M8';
}

function isLaserFocusMode(value: unknown): value is LaserSubProfile['focusMode'] {
  return LASER_FOCUS_MODES.some((mode) => mode === value);
}

function isLaserAirAssistHardware(value: unknown): value is LaserSubProfile['airAssist'] {
  return LASER_AIR_ASSIST_HARDWARE.some((hardware) => hardware === value);
}

function isLaserTechnology(value: unknown): value is NonNullable<LaserSubProfile['technology']> {
  return LASER_TECHNOLOGIES.some((technology) => technology === value);
}

function isLaserHeadMetadataConfidence(
  value: unknown,
): value is NonNullable<LaserSubProfile['metadataConfidence']> {
  return LASER_HEAD_METADATA_CONFIDENCES.some((confidence) => confidence === value);
}
