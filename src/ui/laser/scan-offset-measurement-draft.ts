import {
  mergeScanOffsetTableBySpeed,
  type DeviceProfile,
  type ScanOffsetPoint,
} from '../../core/devices';
import {
  scanOffsetMeasurementFromLaserForge,
  scanOffsetMeasurementToLaserForge,
  scanOffsetSpeedFromMmPerMin,
  scanOffsetSpeedToMmPerMin,
  type ScanOffsetMeasurementConvention,
  type ScanOffsetSpeedUnit,
} from '../../core/devices/scan-offset-measurement-format';
import { scanOffsetMagnitudeLimitMm } from '../../core/devices/scan-offset-profile';

export type DraftScanOffsetMeasurement = {
  readonly speed: string;
  readonly offset: string;
  // Exact native values survive display-only unit/convention switches. Editing
  // the corresponding field clears its canonical value before validation.
  readonly canonicalSpeedMmPerMin?: number;
  readonly canonicalOffsetMm?: number;
};

export type ScanOffsetMeasurementFormat = {
  readonly convention: ScanOffsetMeasurementConvention;
  readonly speedUnit: ScanOffsetSpeedUnit;
};

export type ScanOffsetMeasurementValidation = {
  readonly points: ReadonlyArray<ScanOffsetPoint>;
  readonly errors: ReadonlyArray<string>;
};

export const NATIVE_SCAN_OFFSET_MEASUREMENT_FORMAT: ScanOffsetMeasurementFormat = {
  convention: 'laserforge-full-reverse-only',
  speedUnit: 'mm-per-minute',
};

const DEFAULT_MEASUREMENT_SPEEDS_MM_PER_MIN = [1000, 2000, 3000, 4000, 5000] as const;
const NEXT_SPEED_MM_PER_MIN = 1000;
const NEXT_SPEED_MM_PER_SECOND = 10;

export function rowsFromScanOffsetProfile(
  device: DeviceProfile,
  format: ScanOffsetMeasurementFormat,
): ReadonlyArray<DraftScanOffsetMeasurement> {
  const existing = mergeScanOffsetTableBySpeed(device.scanningOffsets);
  const nativeRows =
    existing.length > 0
      ? existing
      : defaultSpeeds(device.maxFeed).map((speedMmPerMin) => ({
          speedMmPerMin,
          offsetMm: Number.NaN,
        }));
  return nativeRows.map((point) => ({
    speed: displayNumber(scanOffsetSpeedFromMmPerMin(point.speedMmPerMin, format.speedUnit)),
    offset: Number.isFinite(point.offsetMm)
      ? displayNumber(scanOffsetMeasurementFromLaserForge(point.offsetMm, format.convention))
      : '',
    canonicalSpeedMmPerMin: point.speedMmPerMin,
    ...(Number.isFinite(point.offsetMm) ? { canonicalOffsetMm: point.offsetMm } : {}),
  }));
}

export function convertDraftScanOffsetFormat(
  rows: ReadonlyArray<DraftScanOffsetMeasurement>,
  from: ScanOffsetMeasurementFormat,
  to: ScanOffsetMeasurementFormat,
): ReadonlyArray<DraftScanOffsetMeasurement> {
  return rows.map((row) => {
    const canonicalSpeedMmPerMin =
      row.canonicalSpeedMmPerMin ??
      scanOffsetSpeedToMmPerMin(numberFromInput(row.speed), from.speedUnit);
    const canonicalOffsetMm =
      row.canonicalOffsetMm ??
      scanOffsetMeasurementToLaserForge(numberFromInput(row.offset), from.convention);
    return {
      speed: Number.isFinite(canonicalSpeedMmPerMin)
        ? displayNumber(scanOffsetSpeedFromMmPerMin(canonicalSpeedMmPerMin, to.speedUnit))
        : row.speed,
      offset: Number.isFinite(canonicalOffsetMm)
        ? displayNumber(scanOffsetMeasurementFromLaserForge(canonicalOffsetMm, to.convention))
        : row.offset,
      ...(Number.isFinite(canonicalSpeedMmPerMin) ? { canonicalSpeedMmPerMin } : {}),
      ...(Number.isFinite(canonicalOffsetMm) ? { canonicalOffsetMm } : {}),
    };
  });
}

export function nextDraftScanOffsetRow(
  rows: ReadonlyArray<DraftScanOffsetMeasurement>,
  format: ScanOffsetMeasurementFormat,
): DraftScanOffsetMeasurement {
  const speeds = rows.map((row) => numberFromInput(row.speed)).filter(isFinitePositive);
  const increment =
    format.speedUnit === 'mm-per-second' ? NEXT_SPEED_MM_PER_SECOND : NEXT_SPEED_MM_PER_MIN;
  const nextSpeed = speeds.length === 0 ? increment : Math.max(...speeds) + increment;
  return { speed: String(nextSpeed), offset: '' };
}

export function validateMeasuredScanOffsets(
  rows: ReadonlyArray<DraftScanOffsetMeasurement>,
  device: Pick<DeviceProfile, 'bedWidth' | 'bedHeight' | 'maxFeed'>,
  format: ScanOffsetMeasurementFormat = NATIVE_SCAN_OFFSET_MEASUREMENT_FORMAT,
): ScanOffsetMeasurementValidation {
  const points: ScanOffsetPoint[] = [];
  const errors: string[] = [];
  const seenSpeeds = new Set<number>();
  const offsetLimitMm = scanOffsetMagnitudeLimitMm(device);
  rows.forEach((row, index) => {
    if (row.offset.trim() === '') return;
    appendValidatedMeasurement({
      row,
      index,
      device,
      format,
      offsetLimitMm,
      points,
      errors,
      seenSpeeds,
    });
  });
  return {
    points: [...points].sort((left, right) => left.speedMmPerMin - right.speedMmPerMin),
    errors,
  };
}

type ValidationContext = {
  readonly row: DraftScanOffsetMeasurement;
  readonly index: number;
  readonly device: Pick<DeviceProfile, 'maxFeed'>;
  readonly format: ScanOffsetMeasurementFormat;
  readonly offsetLimitMm: number;
  readonly points: ScanOffsetPoint[];
  readonly errors: string[];
  readonly seenSpeeds: Set<number>;
};

function appendValidatedMeasurement(context: ValidationContext): void {
  const inputSpeed = numberFromInput(context.row.speed);
  const inputOffset = numberFromInput(context.row.offset);
  const convertedSpeed =
    context.row.canonicalSpeedMmPerMin ??
    scanOffsetSpeedToMmPerMin(inputSpeed, context.format.speedUnit);
  const speed = normalizeSpeedAtLimit(convertedSpeed, context.device.maxFeed);
  const offset =
    context.row.canonicalOffsetMm ??
    scanOffsetMeasurementToLaserForge(inputOffset, context.format.convention);
  const rowNumber = context.index + 1;
  if (!Number.isFinite(speed) || speed <= 0) {
    context.errors.push(`Measurement ${rowNumber}: speed must be a positive number.`);
    return;
  }
  if (speed > context.device.maxFeed) {
    context.errors.push(speedLimitMessage(rowNumber, inputSpeed, speed, context));
    return;
  }
  if (!Number.isFinite(offset)) {
    context.errors.push(`Measurement ${rowNumber}: offset must be a finite signed number.`);
    return;
  }
  if (Math.abs(offset) > context.offsetLimitMm) {
    context.errors.push(
      `Measurement ${rowNumber}: converted LaserForge offset must be between -${context.offsetLimitMm} and ${context.offsetLimitMm} mm for this bed.`,
    );
    return;
  }
  if (context.seenSpeeds.has(speed)) {
    context.errors.push(`Measurement ${rowNumber}: speed ${speed} mm/min is duplicated.`);
    return;
  }
  context.seenSpeeds.add(speed);
  context.points.push({ speedMmPerMin: speed, offsetMm: offset });
}

function normalizeSpeedAtLimit(speedMmPerMin: number, maxFeedMmPerMin: number): number {
  if (!Number.isFinite(speedMmPerMin) || !Number.isFinite(maxFeedMmPerMin)) return speedMmPerMin;
  const displayRoundTripTolerance = Math.max(1e-9, Math.abs(maxFeedMmPerMin) * 1e-10);
  return speedMmPerMin > maxFeedMmPerMin &&
    speedMmPerMin - maxFeedMmPerMin <= displayRoundTripTolerance
    ? maxFeedMmPerMin
    : speedMmPerMin;
}

function speedLimitMessage(
  rowNumber: number,
  inputSpeed: number,
  speedMmPerMin: number,
  context: ValidationContext,
): string {
  if (context.format.speedUnit === 'mm-per-minute') {
    return `Measurement ${rowNumber}: ${speedMmPerMin} mm/min exceeds the profile limit of ${context.device.maxFeed} mm/min.`;
  }
  return `Measurement ${rowNumber}: ${inputSpeed} mm/s converts to ${speedMmPerMin} mm/min, which exceeds the profile limit of ${context.device.maxFeed} mm/min.`;
}

function defaultSpeeds(maxFeed: number): ReadonlyArray<number> {
  const cappedMax = Number.isFinite(maxFeed) && maxFeed > 0 ? maxFeed : 5000;
  const speeds = DEFAULT_MEASUREMENT_SPEEDS_MM_PER_MIN.filter((speed) => speed <= cappedMax);
  if (speeds.length > 0) return speeds;
  return [Math.max(1, Math.round(cappedMax))];
}

function displayNumber(value: number): string {
  return String(Number(value.toPrecision(12)));
}

function numberFromInput(value: string): number {
  if (value.trim() === '') return Number.NaN;
  return Number(value);
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
