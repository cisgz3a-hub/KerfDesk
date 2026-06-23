import {
  isGrblRxBufferBytes,
  isGrblStreamingMode,
  isScanOffsetTable,
  normalizeGrblRxBufferBytes,
  normalizeGrblStreamingMode,
  normalizeScanOffsetTable,
  type DeviceProfile,
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
};

type MaterialLibraryDeviceHintInput = Omit<
  MaterialLibraryDeviceHint,
  'airAssistCommand' | 'streamingMode' | 'rxBufferBytes' | 'scanningOffsets'
> & {
  readonly airAssistCommand?: DeviceProfile['airAssistCommand'];
  readonly streamingMode?: DeviceProfile['streamingMode'];
  readonly rxBufferBytes?: number;
  readonly scanningOffsets?: ReadonlyArray<ScanOffsetPoint>;
};

const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;

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
    (value.scanningOffsets === undefined || isScanOffsetTable(value.scanningOffsets))
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
