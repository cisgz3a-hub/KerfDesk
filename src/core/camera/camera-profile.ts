// Camera profile/alignment model adapted from Rayforge's MIT-licensed camera
// configuration workflow (machine-owned camera config, lens metadata, and
// image-to-world alignment points).

import { buildCameraTransforms } from './camera-transform';

export type CameraPoint = {
  readonly x: number;
  readonly y: number;
};

export type CameraResolution = {
  readonly width: number;
  readonly height: number;
};

export type CameraAlignmentPoint = {
  readonly image: CameraPoint;
  readonly machine: CameraPoint;
};

export type CameraAlignment = {
  readonly points: ReadonlyArray<CameraAlignmentPoint>;
  readonly alignedAt?: string;
};

export type CameraSource =
  | { readonly kind: 'browser' }
  | { readonly kind: 'rtsp'; readonly url: string };

export const DEFAULT_RTSP_CAMERA_URL = 'rtsp://192.168.10.1:8554/';

export type CameraLensCalibration = {
  readonly calibratedAt?: string;
  readonly imageSize?: CameraResolution;
  readonly cameraMatrix?: {
    readonly fx: number;
    readonly fy: number;
    readonly cx: number;
    readonly cy: number;
  };
  readonly distortion?: {
    readonly k1: number;
    readonly k2: number;
    readonly p1: number;
    readonly p2: number;
    readonly k3: number;
  };
  readonly rmsError?: number;
  readonly framesUsed?: number;
};

export type CameraProfile = {
  readonly id: string;
  readonly name: string;
  readonly deviceId: string;
  readonly enabled: boolean;
  readonly source?: CameraSource;
  readonly resolution?: CameraResolution;
  readonly transparency: number;
  readonly whiteBalanceKelvin?: number;
  readonly brightness?: number;
  readonly contrast?: number;
  readonly denoise?: number;
  readonly preferYuyv?: boolean;
  readonly lensCalibration?: CameraLensCalibration;
  readonly alignment?: CameraAlignment;
};

export type CameraReadiness =
  | { readonly kind: 'ready' }
  | { readonly kind: 'disabled'; readonly reason: string }
  | { readonly kind: 'needs-alignment'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly reason: string };

export function cameraProfileReadiness(profile: CameraProfile | undefined): CameraReadiness {
  if (profile === undefined || !profile.enabled) {
    return { kind: 'disabled', reason: 'Camera is disabled.' };
  }
  if (profile.alignment === undefined) {
    return { kind: 'needs-alignment', reason: 'Add at least four camera alignment points.' };
  }
  const transforms = buildCameraTransforms(profile.alignment);
  if (transforms.kind !== 'ok') return transforms;
  return { kind: 'ready' };
}

export function effectiveCameraSource(profile: CameraProfile): CameraSource {
  return profile.source ?? { kind: 'browser' };
}

export function normalizeCameraProfile(profile: CameraProfile): CameraProfile {
  return {
    id: profile.id,
    name: profile.name,
    deviceId: profile.deviceId,
    enabled: profile.enabled,
    ...(profile.source !== undefined ? { source: normalizeCameraSource(profile.source) } : {}),
    ...(profile.resolution !== undefined
      ? { resolution: normalizeResolution(profile.resolution) }
      : {}),
    transparency: clamp(profile.transparency, 0, 1),
    ...(profile.whiteBalanceKelvin !== undefined
      ? { whiteBalanceKelvin: clamp(profile.whiteBalanceKelvin, 2500, 10000) }
      : {}),
    ...(profile.brightness !== undefined
      ? { brightness: clamp(profile.brightness, -100, 100) }
      : {}),
    ...(profile.contrast !== undefined ? { contrast: clamp(profile.contrast, 0, 100) } : {}),
    ...(profile.denoise !== undefined ? { denoise: clamp(profile.denoise, 0, 0.95) } : {}),
    ...(profile.preferYuyv !== undefined ? { preferYuyv: profile.preferYuyv === true } : {}),
    ...(profile.lensCalibration !== undefined
      ? { lensCalibration: normalizeLensCalibration(profile.lensCalibration) }
      : {}),
    ...(profile.alignment !== undefined
      ? { alignment: normalizeAlignment(profile.alignment) }
      : {}),
  };
}

export function isCameraProfile(value: unknown): value is CameraProfile {
  return validateCameraProfileShape(value) === null;
}

export function validateCameraProfileShape(value: unknown, path = 'cameraProfile'): string | null {
  if (!isRecord(value)) return `${path} is invalid`;
  return firstError([
    validateCameraRequiredFields(value, path),
    validateCameraControls(value, path),
    validateCameraNestedFields(value, path),
  ]);
}

function validateCameraRequiredFields(value: Record<string, unknown>, path: string): string | null {
  if (!isNonEmptyString(value['id'])) return `${path} is invalid`;
  if (!isNonEmptyString(value['name'])) return `${path} is invalid`;
  if (typeof value['deviceId'] !== 'string') return `${path} is invalid`;
  if (typeof value['enabled'] !== 'boolean') return `${path} is invalid`;
  if (!isUnitNumber(value['transparency'])) return `${path} is invalid`;
  return null;
}

function validateCameraControls(value: Record<string, unknown>, path: string): string | null {
  const valid =
    optionalField(value, 'source', isCameraSource) &&
    optionalField(value, 'resolution', isResolution) &&
    optionalField(value, 'whiteBalanceKelvin', (field) => isRangeNumber(field, 2500, 10000)) &&
    optionalField(value, 'brightness', (field) => isRangeNumber(field, -100, 100)) &&
    optionalField(value, 'contrast', (field) => isRangeNumber(field, 0, 100)) &&
    optionalField(value, 'denoise', (field) => isRangeNumber(field, 0, 0.95)) &&
    optionalField(value, 'preferYuyv', (field) => typeof field === 'boolean');
  return valid ? null : `${path} is invalid`;
}

function validateCameraNestedFields(value: Record<string, unknown>, path: string): string | null {
  if (
    value['lensCalibration'] !== undefined &&
    validateLensCalibration(value['lensCalibration'], `${path}.lensCalibration`) !== null
  ) {
    return `${path} is invalid`;
  }
  if (value['alignment'] !== undefined) {
    const alignmentError = validateCameraAlignmentShape(value['alignment'], `${path}.alignment`);
    if (alignmentError !== null) return `${path} is invalid`;
  }
  return null;
}

export function validateCameraAlignmentShape(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path} is invalid`;
  const points = value['points'];
  if (!Array.isArray(points) || points.length < 4) return `${path} needs at least 4 points`;
  for (const point of points) {
    if (!isRecord(point) || !isPoint(point['image']) || !isPoint(point['machine'])) {
      return `${path} is invalid`;
    }
  }
  if (value['alignedAt'] !== undefined && typeof value['alignedAt'] !== 'string') {
    return `${path} is invalid`;
  }
  return null;
}

function validateLensCalibration(value: unknown, path: string): string | null {
  if (!isRecord(value)) return `${path} is invalid`;
  const valid =
    optionalField(value, 'calibratedAt', (field) => typeof field === 'string') &&
    optionalField(value, 'imageSize', isResolution) &&
    optionalField(value, 'cameraMatrix', isCameraMatrix) &&
    optionalField(value, 'distortion', isDistortion) &&
    optionalField(value, 'rmsError', isNonNegativeNumber) &&
    optionalField(value, 'framesUsed', isPositiveInteger);
  return valid ? null : `${path} is invalid`;
}

function normalizeAlignment(alignment: CameraAlignment): CameraAlignment {
  return {
    points: alignment.points.map((point) => ({
      image: { ...point.image },
      machine: { ...point.machine },
    })),
    ...(alignment.alignedAt !== undefined ? { alignedAt: alignment.alignedAt } : {}),
  };
}

function normalizeLensCalibration(calibration: CameraLensCalibration): CameraLensCalibration {
  return {
    ...(calibration.calibratedAt !== undefined ? { calibratedAt: calibration.calibratedAt } : {}),
    ...(calibration.imageSize !== undefined
      ? { imageSize: normalizeResolution(calibration.imageSize) }
      : {}),
    ...(calibration.cameraMatrix !== undefined
      ? { cameraMatrix: { ...calibration.cameraMatrix } }
      : {}),
    ...(calibration.distortion !== undefined ? { distortion: { ...calibration.distortion } } : {}),
    ...(calibration.rmsError !== undefined ? { rmsError: calibration.rmsError } : {}),
    ...(calibration.framesUsed !== undefined ? { framesUsed: calibration.framesUsed } : {}),
  };
}

function normalizeCameraSource(source: CameraSource): CameraSource {
  return source.kind === 'rtsp' ? { kind: 'rtsp', url: source.url.trim() } : { kind: 'browser' };
}

function normalizeResolution(resolution: CameraResolution): CameraResolution {
  return {
    width: Math.max(1, Math.round(resolution.width)),
    height: Math.max(1, Math.round(resolution.height)),
  };
}

function isCameraSource(value: unknown): value is CameraSource {
  if (!isRecord(value)) return false;
  if (value['kind'] === 'browser') return true;
  return value['kind'] === 'rtsp' && isSupportedRtspUrl(value['url']);
}

function isSupportedRtspUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'rtsp:' && isAllowedRtspCameraHost(url.hostname);
  } catch {
    return false;
  }
}

function isAllowedRtspCameraHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  return isAllowedIpv4CameraHost(host);
}

function isAllowedIpv4CameraHost(host: string): boolean {
  const parts = host.split('.').map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function isPoint(value: unknown): value is CameraPoint {
  return isRecord(value) && isFiniteNumber(value['x']) && isFiniteNumber(value['y']);
}

function optionalField(
  obj: Record<string, unknown>,
  key: string,
  validate: (value: unknown) => boolean,
): boolean {
  const value = obj[key];
  return value === undefined || validate(value);
}

function firstError(errors: ReadonlyArray<string | null>): string | null {
  return errors.find((error) => error !== null) ?? null;
}

function isResolution(value: unknown): value is CameraResolution {
  return isRecord(value) && isPositiveInteger(value['width']) && isPositiveInteger(value['height']);
}

function isCameraMatrix(value: unknown): value is CameraLensCalibration['cameraMatrix'] {
  return (
    isRecord(value) &&
    isPositiveNumber(value['fx']) &&
    isPositiveNumber(value['fy']) &&
    isFiniteNumber(value['cx']) &&
    isFiniteNumber(value['cy'])
  );
}

function isDistortion(value: unknown): value is CameraLensCalibration['distortion'] {
  return (
    isRecord(value) &&
    isFiniteNumber(value['k1']) &&
    isFiniteNumber(value['k2']) &&
    isFiniteNumber(value['p1']) &&
    isFiniteNumber(value['p2']) &&
    isFiniteNumber(value['k3'])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0;
}

function isUnitNumber(value: unknown): value is number {
  return isRangeNumber(value, 0, 1);
}

function isRangeNumber(value: unknown, min: number, max: number): value is number {
  return isFiniteNumber(value) && value >= min && value <= max;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
