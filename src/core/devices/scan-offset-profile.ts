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
