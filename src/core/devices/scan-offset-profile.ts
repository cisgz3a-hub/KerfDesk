export type ScanOffsetPoint = {
  readonly speedMmPerMin: number;
  readonly offsetMm: number;
};

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
  const bySpeed = new Map<number, ScanOffsetPoint>();
  for (const point of value.filter(isScanOffsetPoint).map((point) => ({
    speedMmPerMin: point.speedMmPerMin,
    offsetMm: point.offsetMm,
  }))) {
    bySpeed.set(point.speedMmPerMin, point);
  }
  return [...bySpeed.values()].sort((a, b) => a.speedMmPerMin - b.speedMmPerMin);
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
