import type { DeviceProfile, MachineProfileSource } from '../../core/devices';
import { validateMachineProfile } from '../../core/devices';

export const MACHINE_PROFILE_FORMAT = 'laserforge-machine-profile';
export const MACHINE_PROFILE_SCHEMA_VERSION = 1;

export type MachineProfileDocumentSource = {
  readonly kind: MachineProfileSource;
  readonly label: string;
  readonly importedAt?: string;
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
  | { readonly kind: 'invalid'; readonly reason: string };

export function createMachineProfileDocument(
  profile: DeviceProfile,
  options: {
    readonly source: MachineProfileDocumentSource;
    readonly reviewNotes?: ReadonlyArray<string>;
  },
): MachineProfileDocument {
  return canonicalDocument({
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile,
    source: options.source,
    reviewNotes: options.reviewNotes ?? [],
  });
}

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

  const version = raw['schemaVersion'];
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { kind: 'invalid', reason: 'missing or non-numeric schemaVersion' };
  }
  if (version > MACHINE_PROFILE_SCHEMA_VERSION) {
    return { kind: 'schema-too-new', sawVersion: version };
  }
  if (version < MACHINE_PROFILE_SCHEMA_VERSION) {
    return { kind: 'invalid', reason: 'unsupported machine profile schemaVersion' };
  }

  return parseCurrentDocument(raw);
}

function parseCurrentDocument(
  raw: Record<string, unknown>,
): DeserializeMachineProfileDocumentResult {
  const profile = raw['profile'];
  const source = raw['source'];
  const reviewNotes = raw['reviewNotes'];

  if (!isRecord(profile)) {
    return { kind: 'invalid', reason: 'profile must be an object' };
  }
  const profileErrors = validateMachineProfile(profile as DeviceProfile);
  if (profileErrors.length > 0) {
    return { kind: 'invalid', reason: profileErrors.join('; ') };
  }
  if (!isDocumentSource(source)) {
    return { kind: 'invalid', reason: 'source has invalid fields' };
  }
  if (!Array.isArray(reviewNotes) || !reviewNotes.every((note) => typeof note === 'string')) {
    return { kind: 'invalid', reason: 'reviewNotes must be an array of strings' };
  }

  return {
    kind: 'ok',
    document: canonicalDocument({
      format: MACHINE_PROFILE_FORMAT,
      schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
      profile: profile as DeviceProfile,
      source,
      reviewNotes,
    }),
  };
}

function canonicalDocument(document: MachineProfileDocument): MachineProfileDocument {
  return {
    format: MACHINE_PROFILE_FORMAT,
    schemaVersion: MACHINE_PROFILE_SCHEMA_VERSION,
    profile: document.profile,
    source: canonicalSource(document.source),
    reviewNotes: [...document.reviewNotes],
  };
}

function canonicalSource(source: MachineProfileDocumentSource): MachineProfileDocumentSource {
  return {
    kind: source.kind,
    label: source.label,
    ...(source.importedAt !== undefined ? { importedAt: source.importedAt } : {}),
  };
}

function isDocumentSource(value: unknown): value is MachineProfileDocumentSource {
  if (!isRecord(value)) return false;
  return isMachineProfileSource(value.kind) && isNonEmptyString(value.label);
}

function isMachineProfileSource(value: unknown): value is MachineProfileSource {
  return (
    value === 'built-in' ||
    value === 'custom' ||
    value === 'imported-lightburn' ||
    value === 'diagnostic'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
