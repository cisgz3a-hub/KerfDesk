export type ScanOffsetPoint = {
  readonly speedMmPerMin: number;
  readonly offsetMm: number;
};

export type ScanOffsetCalibrationStatus = 'pending' | 'verified';
export type EffectiveScanOffsetCalibrationStatus =
  | 'uncalibrated'
  | 'pending'
  | 'verified'
  | 'legacy-verified';

/** Scan offset is a timing/backlash correction, not a geometry transform. A
 * value above 1% of the shorter bed axis is almost certainly a units or
 * measurement error; the absolute 5 mm ceiling keeps unusually large beds
 * conservative too. */
export const MAX_SCAN_OFFSET_BED_FRACTION = 0.01;
export const ABSOLUTE_MAX_SCAN_OFFSET_MM = 5;

type ScanOffsetBed = {
  readonly bedWidth: number;
  readonly bedHeight: number;
};

type ScanOffsetCalibrationProfile = {
  readonly scanningOffsets: ReadonlyArray<ScanOffsetPoint>;
  readonly scanOffsetCalibrationStatus?: ScanOffsetCalibrationStatus | undefined;
};

type ScanOffsetValidationProfile = ScanOffsetBed & {
  readonly scanningOffsets: unknown;
  readonly scanOffsetCalibrationStatus?: unknown;
};

export function scanOffsetMagnitudeLimitMm(profile: ScanOffsetBed): number {
  const shorterAxis = Math.min(profile.bedWidth, profile.bedHeight);
  if (!Number.isFinite(shorterAxis) || shorterAxis <= 0) return 0;
  return Math.min(ABSOLUTE_MAX_SCAN_OFFSET_MM, shorterAxis * MAX_SCAN_OFFSET_BED_FRACTION);
}

export function isScanOffsetTableForProfile(
  value: unknown,
  profile: ScanOffsetBed,
): value is ReadonlyArray<ScanOffsetPoint> {
  if (!isScanOffsetTable(value)) return false;
  return value.every((point) => isScanOffsetMagnitudeForProfile(point.offsetMm, profile));
}

export function isScanOffsetMagnitudeForProfile(
  value: unknown,
  profile: ScanOffsetBed,
): value is number {
  const limit = scanOffsetMagnitudeLimitMm(profile);
  return isFiniteNumber(value) && limit > 0 && Math.abs(value) <= limit;
}

export function isScanOffsetCalibrationStatus(
  value: unknown,
): value is ScanOffsetCalibrationStatus {
  return value === 'pending' || value === 'verified';
}

export function effectiveScanOffsetCalibrationStatus(
  profile: ScanOffsetCalibrationProfile,
): EffectiveScanOffsetCalibrationStatus {
  if (profile.scanningOffsets.length === 0) return 'uncalibrated';
  if (profile.scanOffsetCalibrationStatus === 'pending') return 'pending';
  if (profile.scanOffsetCalibrationStatus === 'verified') return 'verified';
  // Profiles saved before the lifecycle field existed already treated a
  // nonempty table as calibrated. Preserve that contract on import/load.
  return 'legacy-verified';
}

export function normalizeScanOffsetCalibrationStatus(
  value: unknown,
  scanningOffsets: ReadonlyArray<ScanOffsetPoint>,
): ScanOffsetCalibrationStatus | undefined {
  return scanningOffsets.length > 0 && isScanOffsetCalibrationStatus(value) ? value : undefined;
}

export function validateScanOffsetProfile(
  profile: ScanOffsetValidationProfile,
): ReadonlyArray<string> {
  const errors: string[] = [];
  if (!isScanOffsetTableForProfile(profile.scanningOffsets, profile)) {
    errors.push(
      `scanningOffsets must use unique positive speeds and offsets no larger than ${scanOffsetMagnitudeLimitMm(profile)} mm`,
    );
  }
  if (
    profile.scanOffsetCalibrationStatus !== undefined &&
    !isScanOffsetCalibrationStatus(profile.scanOffsetCalibrationStatus)
  ) {
    errors.push('scanOffsetCalibrationStatus must be pending or verified');
  }
  if (
    profile.scanOffsetCalibrationStatus !== undefined &&
    (!Array.isArray(profile.scanningOffsets) || profile.scanningOffsets.length === 0)
  ) {
    errors.push('scanOffsetCalibrationStatus requires at least one scanningOffsets point');
  }
  return errors;
}

export function isScanOffsetTable(value: unknown): value is ReadonlyArray<ScanOffsetPoint> {
  if (!Array.isArray(value)) return false;
  const seenSpeeds = new Set<number>();
  for (const point of value) {
    if (!isScanOffsetPoint(point)) return false;
    if (seenSpeeds.has(point.speedMmPerMin)) return false;
    seenSpeeds.add(point.speedMmPerMin);
  }
  return true;
}

export function normalizeScanOffsetTable(value: unknown): ReadonlyArray<ScanOffsetPoint> {
  if (!Array.isArray(value)) return [];
  const points = validScanOffsetPoints(value);
  return hasDuplicateSpeeds(points) ? [] : sortBySpeed(points);
}

export function mergeScanOffsetTableBySpeed(value: unknown): ReadonlyArray<ScanOffsetPoint> {
  if (!Array.isArray(value)) return [];
  const bySpeed = new Map<number, ScanOffsetPoint>();
  for (const point of validScanOffsetPoints(value)) bySpeed.set(point.speedMmPerMin, point);
  return sortBySpeed([...bySpeed.values()]);
}

function validScanOffsetPoints(value: ReadonlyArray<unknown>): ReadonlyArray<ScanOffsetPoint> {
  return value.filter(isScanOffsetPoint).map((point) => ({
    speedMmPerMin: point.speedMmPerMin,
    offsetMm: point.offsetMm,
  }));
}

function hasDuplicateSpeeds(points: ReadonlyArray<ScanOffsetPoint>): boolean {
  const seenSpeeds = new Set<number>();
  for (const point of points) {
    if (seenSpeeds.has(point.speedMmPerMin)) return true;
    seenSpeeds.add(point.speedMmPerMin);
  }
  return false;
}

function sortBySpeed(points: ReadonlyArray<ScanOffsetPoint>): ReadonlyArray<ScanOffsetPoint> {
  return [...points].sort((a, b) => a.speedMmPerMin - b.speedMmPerMin);
}

function isScanOffsetPoint(value: unknown): value is ScanOffsetPoint {
  if (!isRecord(value)) return false;
  return isPositiveFinite(value['speedMmPerMin']) && isFiniteNumber(value['offsetMm']);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
