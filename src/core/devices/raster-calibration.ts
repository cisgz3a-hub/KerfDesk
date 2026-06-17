export type RasterCalibrationSource = 'manual' | 'calibration-test' | 'imported-lightburn';

export type RasterBidirectionalOffsetPoint = {
  readonly speedMmPerMin: number;
  readonly offsetMm: number;
};

export type RasterCalibration = {
  readonly enabled: boolean;
  readonly initialXOffsetMm: number;
  readonly bidirectionalOffsetPoints: ReadonlyArray<RasterBidirectionalOffsetPoint>;
  readonly source?: RasterCalibrationSource;
  readonly notes?: string;
};

export type ResolvedRasterScanCalibration = {
  readonly initialXOffsetMm: number;
  readonly bidirectionalOffsetMm: number;
};

export const DEFAULT_RASTER_CALIBRATION: RasterCalibration = {
  enabled: false,
  initialXOffsetMm: 0,
  bidirectionalOffsetPoints: [],
};

const MIN_SPEED_MM_PER_MIN = 1;
const MAX_SCAN_OFFSET_MM = 5;

export function normalizeRasterCalibration(value: unknown): RasterCalibration {
  if (!isRecord(value)) return DEFAULT_RASTER_CALIBRATION;
  const enabled = value['enabled'] === true;
  const initialXOffsetMm = normalizedOffset(value['initialXOffsetMm']);
  const bidirectionalOffsetPoints = normalizeOffsetPoints(value['bidirectionalOffsetPoints']);
  return {
    enabled,
    initialXOffsetMm,
    bidirectionalOffsetPoints,
    ...normalizedSource(value['source']),
    ...normalizedNotes(value['notes']),
  };
}

export function resolveRasterScanCalibration(
  calibration: RasterCalibration | undefined,
  speedMmPerMin: number,
): ResolvedRasterScanCalibration {
  if (calibration === undefined || !calibration.enabled) {
    return { initialXOffsetMm: 0, bidirectionalOffsetMm: 0 };
  }
  return {
    initialXOffsetMm: calibration.initialXOffsetMm,
    bidirectionalOffsetMm: interpolatedOffset(calibration.bidirectionalOffsetPoints, speedMmPerMin),
  };
}

export function scanAxisOffsetForDirection(
  calibration: ResolvedRasterScanCalibration,
  travelDirectionSign: 1 | -1,
): number {
  return calibration.initialXOffsetMm + calibration.bidirectionalOffsetMm * travelDirectionSign;
}

function normalizeOffsetPoints(value: unknown): ReadonlyArray<RasterBidirectionalOffsetPoint> {
  if (!Array.isArray(value)) return [];
  const bySpeed = new Map<number, RasterBidirectionalOffsetPoint>();
  for (const point of value) {
    if (!isRecord(point)) continue;
    const speedMmPerMin = normalizedSpeed(point['speedMmPerMin']);
    const offsetMm = normalizedPointOffset(point['offsetMm']);
    if (speedMmPerMin === null || offsetMm === null) continue;
    bySpeed.set(speedMmPerMin, {
      speedMmPerMin,
      offsetMm,
    });
  }
  return [...bySpeed.values()].sort((left, right) => left.speedMmPerMin - right.speedMmPerMin);
}

function interpolatedOffset(
  points: ReadonlyArray<RasterBidirectionalOffsetPoint>,
  speedMmPerMin: number,
): number {
  if (points.length === 0 || !Number.isFinite(speedMmPerMin)) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) return 0;
  if (speedMmPerMin <= first.speedMmPerMin) return first.offsetMm;
  if (speedMmPerMin >= last.speedMmPerMin) return last.offsetMm;
  for (let i = 1; i < points.length; i += 1) {
    const high = points[i];
    const low = points[i - 1];
    if (high === undefined || low === undefined || speedMmPerMin > high.speedMmPerMin) continue;
    const span = high.speedMmPerMin - low.speedMmPerMin;
    const ratio = (speedMmPerMin - low.speedMmPerMin) / span;
    return low.offsetMm + (high.offsetMm - low.offsetMm) * ratio;
  }
  return last.offsetMm;
}

function normalizedSpeed(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_SPEED_MM_PER_MIN) {
    return null;
  }
  return Math.round(value);
}

function normalizedOffset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(-MAX_SCAN_OFFSET_MM, Math.min(MAX_SCAN_OFFSET_MM, value));
}

function normalizedPointOffset(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return normalizedOffset(value);
}

function normalizedSource(value: unknown): Pick<RasterCalibration, 'source'> {
  return value === 'manual' || value === 'calibration-test' || value === 'imported-lightburn'
    ? { source: value }
    : {};
}

function normalizedNotes(value: unknown): Pick<RasterCalibration, 'notes'> {
  return typeof value === 'string' && value.trim() !== '' ? { notes: value } : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
