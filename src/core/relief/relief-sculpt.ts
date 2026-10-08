import { reliefStrokeSampleWork } from './relief-authoring-work';
import type { ReliefAuthoringDocument, ReliefSculptStroke } from '../scene/relief/relief-authoring';
import type { Vec2 } from '../scene/scene-object';
import { reliefBoundaryContains } from './relief-vector-boundary';

export function applyReliefSculptStrokes(
  values: Float64Array,
  coverage: Uint8Array,
  document: ReliefAuthoringDocument,
  componentId: string,
  cancelled: () => boolean,
): void {
  let work = 0;
  for (const stroke of document.strokes) {
    if (stroke.componentId !== componentId) continue;
    const dabs = reliefStrokeDabs(stroke);
    const radius = stroke.diameterMm / 2;
    const cellX = document.physicalWidthMm / document.width,
      cellY = document.physicalHeightMm / document.height;
    work +=
      dabs.length *
      reliefStrokeSampleWork(stroke) *
      Math.min(document.width, Math.ceil((2 * radius) / cellX / (stroke.metricScaleX ?? 1)) + 2) *
      Math.min(document.height, Math.ceil((2 * radius) / cellY / (stroke.metricScaleY ?? 1)) + 2);
    if (!Number.isSafeInteger(work) || work > 32_000_000)
      throw new Error(
        'Sculpt stroke exceeds the declared work budget; use fewer dabs or a smaller field.',
      );
    for (const centre of dabs) {
      if (cancelled()) throw new Error('Relief authoring cancelled.');
      applyDab(values, coverage, document, stroke, centre, cellX, cellY);
    }
  }
}

/** Physical spacing is deterministic, independent of pointer event frequency. */
export function reliefStrokeDabs(stroke: ReliefSculptStroke): ReadonlyArray<Vec2> {
  const first = stroke.points[0];
  if (first === undefined) return [];
  const dabs: Vec2[] = [first];
  const spacing = stroke.diameterMm / 4;
  let carry = 0;
  for (let i = 1; i < stroke.points.length; i += 1) {
    const a = stroke.points[i - 1],
      b = stroke.points[i];
    if (a === undefined || b === undefined) continue;
    const distance = Math.hypot(
      (b.x - a.x) * (stroke.metricScaleX ?? 1),
      (b.y - a.y) * (stroke.metricScaleY ?? 1),
    );
    if (distance === 0) continue;
    const count = Math.floor((carry + distance) / spacing);
    if (!Number.isSafeInteger(count) || dabs.length + count > 8192)
      throw new Error('Sculpt stroke exceeds 8192 physical dabs.');
    for (let j = 1; j <= count; j += 1) {
      const fraction = (j * spacing - carry) / distance;
      dabs.push({ x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction });
    }
    carry = (carry + distance) % spacing;
  }
  return dabs;
}

function applyDab(
  values: Float64Array,
  coverage: Uint8Array,
  doc: ReliefAuthoringDocument,
  stroke: ReliefSculptStroke,
  centre: Vec2,
  cellX: number,
  cellY: number,
): void {
  const radius = stroke.diameterMm / 2;
  const { sx, sy } = strokeMetric(stroke);
  const x0 = Math.max(0, Math.floor((centre.x - radius / sx) / cellX));
  const x1 = Math.min(doc.width - 1, Math.floor((centre.x + radius / sx) / cellX));
  const y0 = Math.max(0, Math.floor((centre.y - radius / sy) / cellY));
  const y1 = Math.min(doc.height - 1, Math.floor((centre.y + radius / sy) / cellY));
  const changes: Array<readonly [number, number]> = [];
  for (let y = y0; y <= y1; y += 1)
    for (let x = x0; x <= x1; x += 1) {
      const i = y * doc.width + x,
        point = { x: (x + 0.5) * cellX, y: (y + 0.5) * cellY };
      if (!brushPointCovered(coverage[i] ?? 0, stroke, point)) continue;
      const weight = Math.max(
        0,
        1 - Math.hypot((point.x - centre.x) * sx, (point.y - centre.y) * sy) / radius,
      );
      if (weight === 0) continue;
      const before = values[i] ?? 0;
      const smoothed =
        stroke.mode === 'smooth'
          ? smoothDabNeighbourhood(values, coverage, doc, stroke, x, y, cellX, cellY)
          : before;
      const after = sculptDabHeight(stroke, before, weight, smoothed);
      if (!Number.isFinite(after))
        throw new Error('Sculpt height cannot be represented as a finite scalar.');
      changes.push([i, after]);
    }
  // Smooth reads the pre-dab patch: row iteration cannot smear its own writes.
  for (const [i, height] of changes) values[i] = height;
}

function smoothDabNeighbourhood(
  values: Float64Array,
  coverage: Uint8Array,
  doc: ReliefAuthoringDocument,
  stroke: ReliefSculptStroke,
  x: number,
  y: number,
  cellX: number,
  cellY: number,
): number {
  let total = 0,
    count = 0;
  for (let ny = Math.max(0, y - 1); ny <= Math.min(doc.height - 1, y + 1); ny += 1) {
    for (let nx = Math.max(0, x - 1); nx <= Math.min(doc.width - 1, x + 1); nx += 1) {
      const ni = ny * doc.width + nx;
      if (coverage[ni] === 0) continue;
      if (
        stroke.region !== undefined &&
        !reliefBoundaryContains(stroke.region, { x: (nx + 0.5) * cellX, y: (ny + 0.5) * cellY })
      )
        continue;
      total += values[ni] ?? 0;
      count += 1;
    }
  }
  return count === 0 ? (values[y * doc.width + x] ?? 0) : total / count;
}

function strokeMetric(stroke: ReliefSculptStroke): { sx: number; sy: number } {
  return { sx: stroke.metricScaleX ?? 1, sy: stroke.metricScaleY ?? 1 };
}
function brushPointCovered(coverage: number, stroke: ReliefSculptStroke, point: Vec2): boolean {
  return (
    coverage !== 0 && (stroke.region === undefined || reliefBoundaryContains(stroke.region, point))
  );
}

function sculptDabHeight(
  stroke: ReliefSculptStroke,
  before: number,
  weight: number,
  smoothed: number,
): number {
  const amount = stroke.strength * weight;
  switch (stroke.mode) {
    case 'add':
      return before + amount;
    case 'remove':
      return before - amount;
    case 'flatten':
      return before + (stroke.flattenHeightMm - before) * amount;
    case 'smooth':
      return before + (smoothed - before) * amount;
  }
}
