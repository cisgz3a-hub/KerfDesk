export type CameraCaptureBinding = {
  readonly version: 1;
  readonly sourceKind: 'usb' | 'machine-jpeg' | 'machine-rtsp';
  // Stable, non-secret source identity. URLs must be stripped of userinfo,
  // query, and fragment before they reach this persisted core type.
  readonly sourceId: string;
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
  const width = finitePositive(raw.width);
  const height = finitePositive(raw.height);
  const resizeMode = normalizeResizeMode(raw.resizeMode);
  if (
    raw.version !== 1 ||
    sourceKind === undefined ||
    sourceId === undefined ||
    width === undefined ||
    height === undefined ||
    resizeMode === undefined
  ) {
    return undefined;
  }
  return { version: 1, sourceKind, sourceId, width, height, resizeMode };
}

export function cameraBindingCompatibility(
  saved: CameraCaptureBinding | undefined,
  current: CameraCaptureBinding,
): CameraBindingCompatibility {
  if (saved === undefined) return 'unbound';
  if (saved.sourceKind !== current.sourceKind || saved.sourceId !== current.sourceId) {
    return 'source-mismatch';
  }
  if (!captureGeometryMatches(saved, current)) return 'geometry-mismatch';
  return 'match';
}

export function cameraSourceIdWithoutCredentials(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return (
      raw
        .trim()
        .replace(/\/\/[^/@]+@/, '//')
        .split(/[?#]/, 1)[0] ?? 'camera'
    );
  }
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

function finitePositive(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}
