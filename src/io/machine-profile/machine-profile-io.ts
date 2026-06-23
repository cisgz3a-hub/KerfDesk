import {
  isScanOffsetTable,
  normalizeGcodeDialectSelection,
  normalizeGrblRxBufferBytes,
  normalizeGrblStreamingMode,
  normalizeScanOffsetTable,
  validateMachineProfile,
  type DeviceProfile,
  type MachineProfileSource,
  type NoGoZone,
  type Origin,
} from '../../core/devices';
import { validateMachineProfileShape } from './machine-profile-shape';

export const MACHINE_PROFILE_FORMAT = 'laserforge-machine-profile';
export const MACHINE_PROFILE_SCHEMA_VERSION = 1;

export type MachineProfileDocumentSource = {
  readonly kind: MachineProfileSource;
  readonly label: string;
  readonly sourceFileName?: string;
  readonly catalogVersion?: string;
};

export type MachineProfileDocument = {
  readonly format: typeof MACHINE_PROFILE_FORMAT;
  readonly schemaVersion: typeof MACHINE_PROFILE_SCHEMA_VERSION;
  readonly profile: DeviceProfile;
  readonly source: MachineProfileDocumentSource;
  readonly reviewNotes: ReadonlyArray<string>;
};

export type DeserializeMachineProfileDocumentResult =
  | { readonly kind: 'ok'; readonly document: MachineProfileDocument }
  | { readonly kind: 'schema-too-new'; readonly sawVersion: number }
  | { readonly kind: 'schema-too-old'; readonly sawVersion: number }
  | { readonly kind: 'invalid'; readonly reason: string };

const ORIGINS = ['front-left', 'front-right', 'rear-left', 'rear-right', 'center'] as const;
const PROFILE_SOURCES = ['built-in', 'custom', 'imported', 'lightburn'] as const;

export function serializeMachineProfileDocument(document: MachineProfileDocument): string {
  return `${JSON.stringify(canonicalDocument(document), null, 2)}\n`;
}

export function deserializeMachineProfileDocument(
  jsonText: string,
): DeserializeMachineProfileDocumentResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }

  if (!isRecord(raw)) {
    return { kind: 'invalid', reason: 'top-level value is not an object' };
  }
  if (raw['format'] !== MACHINE_PROFILE_FORMAT) {
    return { kind: 'invalid', reason: 'wrong machine profile format' };
  }

  const schemaVersion = raw['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    return { kind: 'invalid', reason: 'missing or non-numeric schemaVersion' };
  }
  if (schemaVersion > MACHINE_PROFILE_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: schemaVersion };
  }
  if (schemaVersion < MACHINE_PROFILE_SCHEMA_VERSION) {
    return { kind: 'schema-too-old', sawVersion: schemaVersion };
  }

  const source = parseSource(raw['source']);
  if (source.kind === 'invalid') return source;

  const reviewNotes = parseReviewNotes(raw['reviewNotes']);
  if (reviewNotes.kind === 'invalid') return reviewNotes;

  const profile = parseProfile(raw['profile']);
  if (profile.kind === 'invalid') return profile;

  return {
    kind: 'ok',
    document: canonicalDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: profile.profile,
      source: source.source,
      reviewNotes: reviewNotes.reviewNotes,
    }),
  };
}

function parseSource(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly source: MachineProfileDocumentSource }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!isRecord(value)) {
    return { kind: 'invalid', reason: 'source must be an object' };
  }
  if (!isProfileSource(value['kind'])) {
    return { kind: 'invalid', reason: 'source.kind is invalid' };
  }
  if (!isNonEmptyString(value['label'])) {
    return { kind: 'invalid', reason: 'source.label must be a non-empty string' };
  }
  if (value['sourceFileName'] !== undefined && !isNonEmptyString(value['sourceFileName'])) {
    return { kind: 'invalid', reason: 'source.sourceFileName must be a non-empty string' };
  }
  if (value['catalogVersion'] !== undefined && !isNonEmptyString(value['catalogVersion'])) {
    return { kind: 'invalid', reason: 'source.catalogVersion must be a non-empty string' };
  }
  return {
    kind: 'ok',
    source: {
      kind: value['kind'],
      label: value['label'],
      ...(value['sourceFileName'] !== undefined ? { sourceFileName: value['sourceFileName'] } : {}),
      ...(value['catalogVersion'] !== undefined ? { catalogVersion: value['catalogVersion'] } : {}),
    },
  };
}

function parseReviewNotes(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly reviewNotes: ReadonlyArray<string> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return { kind: 'invalid', reason: 'reviewNotes must be an array of strings' };
  }
  return { kind: 'ok', reviewNotes: value };
}

function parseProfile(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly profile: DeviceProfile }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!isRecord(value)) {
    return { kind: 'invalid', reason: 'profile must be an object' };
  }
  if (value['scanningOffsets'] !== undefined && !isScanOffsetTable(value['scanningOffsets'])) {
    return { kind: 'invalid', reason: 'profile.scanningOffsets is invalid' };
  }
  const profileShapeError = validateMachineProfileShape(value);
  if (profileShapeError !== null) return { kind: 'invalid', reason: profileShapeError };
  const noGoZones = parseNoGoZones(value['noGoZones']);
  if (noGoZones.kind === 'invalid') return noGoZones;

  const profile = canonicalProfile({
    ...validatedDeviceProfile(value),
    gcodeDialect: normalizeGcodeDialectSelection(value['gcodeDialect']),
    streamingMode: normalizeGrblStreamingMode(value['streamingMode']),
    rxBufferBytes: normalizeGrblRxBufferBytes(value['rxBufferBytes']),
    scanningOffsets: normalizeScanOffsetTable(value['scanningOffsets']),
    noGoZones: noGoZones.noGoZones,
  });
  const validationErrors = validateMachineProfile(profile);
  if (validationErrors.length > 0) {
    return { kind: 'invalid', reason: `profile is invalid: ${validationErrors.join('; ')}` };
  }
  if (!isOrigin(profile.origin)) {
    return { kind: 'invalid', reason: 'profile.origin is invalid' };
  }
  if (!isAirAssistCommand(profile.airAssistCommand)) {
    return { kind: 'invalid', reason: 'profile.airAssistCommand is invalid' };
  }
  return { kind: 'ok', profile };
}

function validatedDeviceProfile(value: Record<string, unknown>): DeviceProfile {
  // validateProfileShape proves the imported JSON has DeviceProfile's required
  // fields and nested safety fields; TypeScript cannot infer that from Record.
  return value as unknown as DeviceProfile;
}

function parseNoGoZones(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly noGoZones: ReadonlyArray<NoGoZone> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (value === undefined) return { kind: 'ok', noGoZones: [] };
  if (!Array.isArray(value)) return { kind: 'invalid', reason: 'profile.noGoZones is invalid' };
  const zones: NoGoZone[] = [];
  for (const [index, zone] of value.entries()) {
    if (!isRecord(zone)) return invalidNoGoZone(index);
    if (
      !isNonEmptyString(zone['id']) ||
      !isNonEmptyString(zone['name']) ||
      typeof zone['enabled'] !== 'boolean' ||
      !isNonNegativeFinite(zone['x']) ||
      !isNonNegativeFinite(zone['y']) ||
      !isPositiveFinite(zone['width']) ||
      !isPositiveFinite(zone['height'])
    ) {
      return invalidNoGoZone(index);
    }
    zones.push({
      id: zone['id'],
      name: zone['name'],
      enabled: zone['enabled'],
      x: zone['x'],
      y: zone['y'],
      width: zone['width'],
      height: zone['height'],
    });
  }
  return { kind: 'ok', noGoZones: zones };
}

function canonicalDocument(document: MachineProfileDocument): MachineProfileDocument {
  return {
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile: canonicalProfile(document.profile),
    source: canonicalSource(document.source),
    reviewNotes: [...document.reviewNotes],
  };
}

function canonicalSource(source: MachineProfileDocumentSource): MachineProfileDocumentSource {
  return {
    kind: source.kind,
    label: source.label,
    ...(source.sourceFileName !== undefined ? { sourceFileName: source.sourceFileName } : {}),
    ...(source.catalogVersion !== undefined ? { catalogVersion: source.catalogVersion } : {}),
  };
}

function canonicalProfile(profile: DeviceProfile): DeviceProfile {
  return {
    ...canonicalIdentityMetadata(profile),
    name: profile.name,
    ...canonicalMachineMetadata(profile),
    gcodeDialect: normalizeGcodeDialectSelection(profile.gcodeDialect),
    streamingMode: normalizeGrblStreamingMode(profile.streamingMode),
    rxBufferBytes: normalizeGrblRxBufferBytes(profile.rxBufferBytes),
    bedWidth: profile.bedWidth,
    bedHeight: profile.bedHeight,
    maxFeed: profile.maxFeed,
    maxPowerS: profile.maxPowerS,
    minPowerS: profile.minPowerS,
    laserModeEnabled: profile.laserModeEnabled,
    airAssistCommand: profile.airAssistCommand,
    scanningOffsets: normalizeScanOffsetTable(profile.scanningOffsets),
    noGoZones: profile.noGoZones.map((zone) => ({ ...zone })),
    origin: profile.origin,
    homing: { ...profile.homing },
    autofocusCommand: profile.autofocusCommand,
    framingFeedMmPerMin: profile.framingFeedMmPerMin,
    accelMmPerSec2: profile.accelMmPerSec2,
    junctionDeviationMm: profile.junctionDeviationMm,
    ...canonicalZMetadata(profile),
  };
}

function canonicalIdentityMetadata(profile: DeviceProfile): Partial<DeviceProfile> {
  return {
    ...(profile.profileId !== undefined ? { profileId: profile.profileId } : {}),
    ...(profile.vendor !== undefined ? { vendor: profile.vendor } : {}),
    ...(profile.model !== undefined ? { model: profile.model } : {}),
    ...(profile.profileSource !== undefined ? { profileSource: profile.profileSource } : {}),
    ...(profile.catalogVersion !== undefined ? { catalogVersion: profile.catalogVersion } : {}),
    ...(profile.capabilities !== undefined ? { capabilities: [...profile.capabilities] } : {}),
    ...(profile.evidence !== undefined
      ? { evidence: profile.evidence.map((item) => ({ ...item })) }
      : {}),
  };
}

function canonicalMachineMetadata(profile: DeviceProfile): Partial<DeviceProfile> {
  return {
    ...(profile.machineFamily !== undefined ? { machineFamily: profile.machineFamily } : {}),
    ...(profile.controllerKind !== undefined ? { controllerKind: profile.controllerKind } : {}),
    ...(profile.laserSubProfile !== undefined
      ? { laserSubProfile: { ...profile.laserSubProfile } }
      : {}),
  };
}

function canonicalZMetadata(profile: DeviceProfile): Partial<DeviceProfile> {
  return {
    ...(profile.zTravelMm !== undefined ? { zTravelMm: profile.zTravelMm } : {}),
    ...(profile.zTravelConfirmed !== undefined
      ? { zTravelConfirmed: profile.zTravelConfirmed }
      : {}),
    ...(profile.zProbePresent !== undefined ? { zProbePresent: profile.zProbePresent } : {}),
  };
}

function invalidNoGoZone(index: number): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason: `profile.noGoZones[${index}] is invalid` };
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

function isOrigin(value: unknown): value is Origin {
  return ORIGINS.some((origin) => origin === value);
}

function isAirAssistCommand(value: unknown): value is DeviceProfile['airAssistCommand'] {
  return value === 'none' || value === 'M7' || value === 'M8';
}
