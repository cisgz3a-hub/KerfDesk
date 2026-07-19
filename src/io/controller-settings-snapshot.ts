import { isKnownControllerKind, type ControllerKind } from '../core/devices/device-profile';
import { settingsMapToRows, type GrblSettingRow } from '../core/controllers/grbl/grbl-settings';

export const CONTROLLER_SETTINGS_SNAPSHOT_FORMAT = 'laserforge.controller-settings.snapshot';
export const CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION = 1;

export type ControllerSettingsSnapshotProfile = {
  readonly profileId: string | null;
  readonly name: string;
};

export type ControllerSettingsSnapshotKinds = {
  /** Controller family selected by the captured machine profile, if explicit. */
  readonly profile: ControllerKind | null;
  /** Driver that owned the connection when the settings were read. */
  readonly active: ControllerKind;
  /** Firmware family inferred from the banner, if the controller reported one. */
  readonly detected: ControllerKind | null;
};

export type ControllerSettingsSnapshotValue = {
  readonly id: number;
  readonly rawValue: string;
};

/** Read-only controller evidence. This document never contains write commands. */
export type ControllerSettingsSnapshot = {
  readonly format: typeof CONTROLLER_SETTINGS_SNAPSHOT_FORMAT;
  readonly schemaVersion: typeof CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION;
  readonly capturedAt: string;
  readonly operatorLabel: string;
  readonly profile: ControllerSettingsSnapshotProfile;
  readonly controllerKinds: ControllerSettingsSnapshotKinds;
  readonly settings: ReadonlyArray<ControllerSettingsSnapshotValue>;
};

export type CreateControllerSettingsSnapshotInput = {
  readonly capturedAt: string;
  readonly operatorLabel: string;
  readonly profile: ControllerSettingsSnapshotProfile;
  readonly controllerKinds: ControllerSettingsSnapshotKinds;
  readonly settings: ReadonlyArray<Pick<GrblSettingRow, 'id' | 'rawValue'>>;
};

export type DeserializeControllerSettingsSnapshotResult =
  | { readonly kind: 'ok'; readonly snapshot: ControllerSettingsSnapshot }
  | { readonly kind: 'schema-too-new'; readonly sawVersion: number }
  | { readonly kind: 'schema-too-old'; readonly sawVersion: number }
  | { readonly kind: 'invalid'; readonly reason: string };

const TOP_LEVEL_KEYS = [
  'format',
  'schemaVersion',
  'capturedAt',
  'operatorLabel',
  'profile',
  'controllerKinds',
  'settings',
] as const;
const PROFILE_KEYS = ['profileId', 'name'] as const;
const CONTROLLER_KIND_KEYS = ['profile', 'active', 'detected'] as const;
const SETTING_KEYS = ['id', 'rawValue'] as const;

export function createControllerSettingsSnapshot(
  input: CreateControllerSettingsSnapshotInput,
): ControllerSettingsSnapshot {
  const result = parseSnapshot({
    format: CONTROLLER_SETTINGS_SNAPSHOT_FORMAT,
    schemaVersion: CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
    capturedAt: input.capturedAt,
    operatorLabel: input.operatorLabel,
    profile: input.profile,
    controllerKinds: input.controllerKinds,
    settings: input.settings.map(({ id, rawValue }) => ({ id, rawValue })),
  });
  if (result.kind !== 'ok') {
    const detail =
      result.kind === 'invalid' ? result.reason : `schema version ${result.sawVersion}`;
    throw new TypeError(`Invalid controller settings snapshot: ${detail}`);
  }
  return result.snapshot;
}

export function serializeControllerSettingsSnapshot(snapshot: ControllerSettingsSnapshot): string {
  const result = parseSnapshot(snapshot);
  if (result.kind !== 'ok') {
    const detail =
      result.kind === 'invalid' ? result.reason : `schema version ${result.sawVersion}`;
    throw new TypeError(`Invalid controller settings snapshot: ${detail}`);
  }
  return `${JSON.stringify(result.snapshot, null, 2)}\n`;
}

export function deserializeControllerSettingsSnapshot(
  jsonText: string,
): DeserializeControllerSettingsSnapshotResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'invalid', reason: `not valid JSON: ${message}` };
  }
  return parseSnapshot(raw);
}

/** Rebuilds current named/unit-aware rows from the snapshot's raw evidence. */
export function controllerSettingsSnapshotToRows(
  snapshot: ControllerSettingsSnapshot,
): ReadonlyArray<GrblSettingRow> {
  const result = parseSnapshot(snapshot);
  if (result.kind !== 'ok') {
    const detail =
      result.kind === 'invalid' ? result.reason : `schema version ${result.sawVersion}`;
    throw new TypeError(`Invalid controller settings snapshot: ${detail}`);
  }
  return settingsMapToRows(
    new Map(result.snapshot.settings.map((setting) => [setting.id, setting.rawValue])),
  );
}

function parseSnapshot(value: unknown): DeserializeControllerSettingsSnapshotResult {
  if (!isRecord(value)) return { kind: 'invalid', reason: 'top-level value is not an object' };
  if (value['format'] !== CONTROLLER_SETTINGS_SNAPSHOT_FORMAT) {
    return { kind: 'invalid', reason: 'wrong controller settings snapshot format' };
  }

  const schemaVersion = value['schemaVersion'];
  if (typeof schemaVersion !== 'number' || !Number.isFinite(schemaVersion)) {
    return { kind: 'invalid', reason: 'missing or non-numeric schemaVersion' };
  }
  if (schemaVersion > CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: schemaVersion };
  }
  if (schemaVersion < CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION) {
    return { kind: 'schema-too-old', sawVersion: schemaVersion };
  }

  const unexpectedTopLevel = firstUnexpectedKey(value, TOP_LEVEL_KEYS);
  if (unexpectedTopLevel !== null) {
    return { kind: 'invalid', reason: `unexpected top-level field ${unexpectedTopLevel}` };
  }
  const captureMetadataError = validateCaptureMetadata(value);
  if (captureMetadataError !== null) return { kind: 'invalid', reason: captureMetadataError };

  const profile = parseProfile(value['profile']);
  if (profile.kind === 'invalid') return profile;
  const controllerKinds = parseControllerKinds(value['controllerKinds']);
  if (controllerKinds.kind === 'invalid') return controllerKinds;
  const settings = parseSettings(value['settings']);
  if (settings.kind === 'invalid') return settings;

  return {
    kind: 'ok',
    snapshot: {
      format: CONTROLLER_SETTINGS_SNAPSHOT_FORMAT,
      schemaVersion: CONTROLLER_SETTINGS_SNAPSHOT_SCHEMA_VERSION,
      capturedAt: value['capturedAt'] as string,
      operatorLabel: value['operatorLabel'] as string,
      profile: profile.profile,
      controllerKinds: controllerKinds.controllerKinds,
      settings: settings.settings,
    },
  };
}

function validateCaptureMetadata(value: Readonly<Record<string, unknown>>): string | null {
  if (!isIsoTimestamp(value['capturedAt'])) {
    return 'capturedAt must be a canonical ISO timestamp';
  }
  if (!isTrimmedNonEmptyString(value['operatorLabel'])) {
    return 'operatorLabel must be a trimmed non-empty string';
  }
  return null;
}

function parseProfile(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly profile: ControllerSettingsSnapshotProfile }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!isRecord(value)) return { kind: 'invalid', reason: 'profile must be an object' };
  const unexpected = firstUnexpectedKey(value, PROFILE_KEYS);
  if (unexpected !== null) {
    return { kind: 'invalid', reason: `unexpected profile field ${unexpected}` };
  }
  if (value['profileId'] !== null && !isTrimmedNonEmptyString(value['profileId'])) {
    return {
      kind: 'invalid',
      reason: 'profile.profileId must be null or a trimmed non-empty string',
    };
  }
  if (!isTrimmedNonEmptyString(value['name'])) {
    return { kind: 'invalid', reason: 'profile.name must be a trimmed non-empty string' };
  }
  return {
    kind: 'ok',
    profile: { profileId: value['profileId'], name: value['name'] },
  };
}

function parseControllerKinds(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly controllerKinds: ControllerSettingsSnapshotKinds }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!isRecord(value)) {
    return { kind: 'invalid', reason: 'controllerKinds must be an object' };
  }
  const unexpected = firstUnexpectedKey(value, CONTROLLER_KIND_KEYS);
  if (unexpected !== null) {
    return { kind: 'invalid', reason: `unexpected controllerKinds field ${unexpected}` };
  }
  if (value['profile'] !== null && !isKnownControllerKind(value['profile'])) {
    return { kind: 'invalid', reason: 'controllerKinds.profile is invalid' };
  }
  if (!isKnownControllerKind(value['active'])) {
    return { kind: 'invalid', reason: 'controllerKinds.active is invalid' };
  }
  if (value['detected'] !== null && !isKnownControllerKind(value['detected'])) {
    return { kind: 'invalid', reason: 'controllerKinds.detected is invalid' };
  }
  return {
    kind: 'ok',
    controllerKinds: {
      profile: value['profile'],
      active: value['active'],
      detected: value['detected'],
    },
  };
}

function parseSettings(
  value: unknown,
):
  | { readonly kind: 'ok'; readonly settings: ReadonlyArray<ControllerSettingsSnapshotValue> }
  | { readonly kind: 'invalid'; readonly reason: string } {
  if (!Array.isArray(value)) return { kind: 'invalid', reason: 'settings must be an array' };
  const ids = new Set<number>();
  const settings: ControllerSettingsSnapshotValue[] = [];
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      return { kind: 'invalid', reason: `settings[${index}] must be an object` };
    }
    const unexpected = firstUnexpectedKey(item, SETTING_KEYS);
    if (unexpected !== null) {
      return { kind: 'invalid', reason: `unexpected settings[${index}] field ${unexpected}` };
    }
    if (!Number.isSafeInteger(item['id']) || (item['id'] as number) < 0) {
      return { kind: 'invalid', reason: `settings[${index}].id must be a non-negative integer` };
    }
    if (typeof item['rawValue'] !== 'string') {
      return { kind: 'invalid', reason: `settings[${index}].rawValue must be a string` };
    }
    const id = item['id'] as number;
    if (ids.has(id)) {
      return { kind: 'invalid', reason: `settings contains duplicate id ${id}` };
    }
    ids.add(id);
    settings.push({ id, rawValue: item['rawValue'] });
  }
  settings.sort((left, right) => left.id - right.id);
  return { kind: 'ok', settings };
}

function firstUnexpectedKey(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlyArray<string>,
): string | null {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).find((key) => !allowed.has(key)) ?? null;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isTrimmedNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
