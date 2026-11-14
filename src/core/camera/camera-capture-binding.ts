import { publicCameraAddress } from './camera-address-login';

export type CameraCaptureBinding = {
  readonly version: 1;
  readonly sourceKind: 'usb' | 'machine-jpeg' | 'machine-rtsp';
  // Stable, non-secret source identity. Network addresses are only ever held
  // in their public form (ADR-692), also when an older file is read.
  readonly sourceId: string;
  // App-keyed network resource identity, including an explicitly empty query.
  // Absent for USB, ambiguous legacy bindings, or unavailable secure identity.
  readonly queryFingerprint?: string;
  // The same camera's identity on any computer: a slow hash of its address
  // without its login (ADR-692 Amendment 3). Absent in older files.
  readonly portableFingerprint?: string;
  readonly width: number;
  readonly height: number;
  readonly resizeMode: 'none' | 'crop-and-scale' | 'unknown';
};

export type CameraBindingCompatibility =
  | 'match'
  | 'unbound'
  | 'source-mismatch'
  | 'geometry-mismatch';

export function normalizeCameraCaptureBinding(value: unknown): CameraCaptureBinding | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const raw = value as Record<string, unknown>;
  const sourceKind = normalizeSourceKind(raw.sourceKind);
  const sourceId = nonEmptyString(raw.sourceId);
  const fingerprints = normalizeFingerprints(raw);
  const width = finitePositive(raw.width);
  const height = finitePositive(raw.height);
  const resizeMode = normalizeResizeMode(raw.resizeMode);
  if (
    raw.version !== 1 ||
    sourceKind === undefined ||
    sourceId === undefined ||
    fingerprints === undefined ||
    width === undefined ||
    height === undefined ||
    resizeMode === undefined
  ) {
    return undefined;
  }
  return {
    version: 1,
    sourceKind,
    sourceId: persistedSourceId(sourceKind, sourceId),
    width,
    height,
    resizeMode,
    ...fingerprints,
  };
}

// A network camera's identities; undefined when a keyed one is malformed. A
// malformed portable one is dropped: the keyed one still names the camera.
function normalizeFingerprints(
  raw: Record<string, unknown>,
): Pick<CameraCaptureBinding, 'queryFingerprint' | 'portableFingerprint'> | undefined {
  const queryFingerprint = normalizeQueryFingerprint(raw.queryFingerprint);
  if (raw.queryFingerprint !== undefined && queryFingerprint === undefined) return undefined;
  const portableFingerprint = normalizePortableFingerprint(raw.portableFingerprint);
  return {
    ...(queryFingerprint === undefined ? {} : { queryFingerprint }),
    ...(portableFingerprint === undefined ? {} : { portableFingerprint }),
  };
}

function normalizePortableFingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && /^pbkdf2-sha256:[0-9a-f]{64}$/.test(value)
    ? value
    : undefined;
}

/**
 * How two network identities compare (ADR-692 Amendment 3): `same` by this
 * computer's keyed fingerprint; `elsewhere` when only the portable one
 * agrees (another computer, or a changed password); `different`; or
 * `unknown` when neither can be compared.
 */
export function networkIdentityMatch(
  saved: Pick<CameraCaptureBinding, 'queryFingerprint' | 'portableFingerprint'>,
  current: Pick<CameraCaptureBinding, 'queryFingerprint' | 'portableFingerprint'>,
): 'same' | 'elsewhere' | 'different' | 'unknown' {
  const keyed = saved.queryFingerprint !== undefined && current.queryFingerprint !== undefined;
  if (keyed && saved.queryFingerprint === current.queryFingerprint) return 'same';
  const portable =
    saved.portableFingerprint !== undefined && current.portableFingerprint !== undefined;
  if (portable && saved.portableFingerprint === current.portableFingerprint) return 'elsewhere';
  return keyed || portable ? 'different' : 'unknown';
}

export function cameraBindingCompatibility(
  saved: CameraCaptureBinding | undefined,
  current: CameraCaptureBinding,
): CameraBindingCompatibility {
  if (saved === undefined) return 'unbound';
  if (!sameCameraSource(saved, current)) {
    return 'source-mismatch';
  }
  if (current.sourceKind !== 'usb') {
    const identity = networkIdentityMatch(saved, current);
    if (identity === 'unknown') return 'unbound';
    if (identity === 'different') return 'source-mismatch';
  } else if (saved.queryFingerprint !== current.queryFingerprint) {
    return 'source-mismatch';
  }
  if (!captureGeometryMatches(saved, current)) return 'geometry-mismatch';
  return 'match';
}

/** A network camera's address as it may be saved: no login anywhere in it. */
export function cameraSourceIdWithoutCredentials(raw: string): string {
  return publicCameraAddress(raw);
}

/** True when both name one camera source, compared in the form that is saved. */
export function sameCameraSource(
  a: Pick<CameraCaptureBinding, 'sourceKind' | 'sourceId'>,
  b: Pick<CameraCaptureBinding, 'sourceKind' | 'sourceId'>,
): boolean {
  return (
    a.sourceKind === b.sourceKind &&
    persistedSourceId(a.sourceKind, a.sourceId) === persistedSourceId(b.sourceKind, b.sourceId)
  );
}

// Older versions could save more than the public form; reading drops it.
function persistedSourceId(kind: CameraCaptureBinding['sourceKind'], sourceId: string): string {
  return kind === 'usb' ? sourceId : cameraSourceIdWithoutCredentials(sourceId);
}

function captureGeometryMatches(a: CameraCaptureBinding, b: CameraCaptureBinding): boolean {
  if (a.resizeMode === 'crop-and-scale' || b.resizeMode === 'crop-and-scale') {
    return a.width === b.width && a.height === b.height && a.resizeMode === b.resizeMode;
  }
  const aRatio = a.width / a.height;
  const bRatio = b.width / b.height;
  return Math.abs(aRatio - bRatio) <= 0.001;
}

function normalizeSourceKind(value: unknown): CameraCaptureBinding['sourceKind'] | undefined {
  return value === 'usb' || value === 'machine-jpeg' || value === 'machine-rtsp'
    ? value
    : undefined;
}

function normalizeResizeMode(value: unknown): CameraCaptureBinding['resizeMode'] | undefined {
  return value === 'none' || value === 'crop-and-scale' || value === 'unknown' ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function normalizeQueryFingerprint(value: unknown): string | undefined {
  return typeof value === 'string' && /^hmac-sha256:[0-9a-f]{64}$/.test(value) ? value : undefined;
}

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
