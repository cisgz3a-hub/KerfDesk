import { normalizeCameraModelRecord } from '../model/camera-model-record';
import type { SurfaceHeightArea } from '../model/height-areas';
import type { DetectedPiece } from '../pieces/find-pieces';
import type { DesignFrame } from '../pieces/piece-placements';
import type { Vec2 } from '../../scene/scene-object';
import {
  FIXTURE_LIMITS,
  type FixtureBasis,
  type FixtureCameraContext,
  type FixtureQualification,
  type FixtureTemplate,
} from './fixture-template';

export function normalizeFixtureTemplates(
  value: unknown,
): ReadonlyArray<FixtureTemplate> | undefined {
  if (
    !Array.isArray(value) ||
    value.length > FIXTURE_LIMITS.templates ||
    !withinBytes(value, FIXTURE_LIMITS.collectionBytes)
  )
    return undefined;
  const result = value.map(normalizeFixtureTemplate);
  if (result.some((item) => item === undefined)) return undefined;
  const templates = result as FixtureTemplate[];
  return new Set(templates.map((item) => item.id)).size === templates.length
    ? templates
    : undefined;
}
export function normalizeFixtureTemplate(value: unknown): FixtureTemplate | undefined {
  if (!record(value) || value['version'] !== 1 || !withinBytes(value, FIXTURE_LIMITS.templateBytes))
    return undefined;
  const id = text(value['id'], 160),
    name = text(value['name'], 120);
  const createdAt = timestamp(value['createdAt']),
    updatedAt = timestamp(value['updatedAt']);
  const basis = normalizeBasis(value['basis']),
    slots = normalizeSlots(value['slots']);
  if (
    id === undefined ||
    name === undefined ||
    createdAt === undefined ||
    updatedAt === undefined ||
    basis === undefined ||
    slots === undefined
  )
    return undefined;
  const optional = normalizeOptionalFields(value, slots);
  return optional === undefined
    ? undefined
    : { version: 1, id, name, createdAt, updatedAt, basis, slots, ...optional };
}
function normalizeOptionalFields(
  value: Record<string, unknown>,
  slots: FixtureTemplate['slots'],
): Pick<FixtureTemplate, 'sample' | 'camera' | 'qualification'> | undefined {
  const camera = value['camera'] === undefined ? undefined : normalizeCamera(value['camera']);
  const sample = normalizeSample(value['sample'], slots);
  const qualification =
    value['qualification'] === undefined
      ? undefined
      : normalizeQualification(value['qualification']);
  if (
    (value['camera'] !== undefined && camera === undefined) ||
    sample === null ||
    (value['qualification'] !== undefined && qualification === undefined)
  )
    return undefined;
  return {
    ...(camera === undefined ? {} : { camera }),
    ...(sample === undefined ? {} : { sample }),
    ...(qualification === undefined ? {} : { qualification }),
  };
}
function normalizeBasis(value: unknown): FixtureBasis | undefined {
  if (!record(value) || value['kind'] !== 'scene-mm') return undefined;
  const deviceProfileId = text(value['deviceProfileId'], 160);
  const bedWidthMm = positive(value['bedWidthMm']),
    bedHeightMm = positive(value['bedHeightMm']);
  return deviceProfileId === undefined || bedWidthMm === undefined || bedHeightMm === undefined
    ? undefined
    : { kind: 'scene-mm', deviceProfileId, bedWidthMm, bedHeightMm };
}
function normalizeSlots(value: unknown): FixtureTemplate['slots'] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > FIXTURE_LIMITS.slots)
    return undefined;
  const slots: Array<{ id: string; piece: DetectedPiece }> = [];
  let pointCount = 0;
  for (const item of value) {
    if (!record(item)) return undefined;
    const id = text(item['id'], 160),
      piece = normalizePiece(item['piece']);
    if (id === undefined || piece === undefined) return undefined;
    pointCount += piece.outline.length;
    if (pointCount > FIXTURE_LIMITS.totalPoints) return undefined;
    slots.push({ id, piece });
  }
  return new Set(slots.map((slot) => slot.id)).size === slots.length ? slots : undefined;
}
function normalizePiece(value: unknown): DetectedPiece | undefined {
  if (!record(value) || !record(value['rect'])) return undefined;
  const outline = normalizeOutline(value['outline']);
  const rect = normalizeRect(value['rect']),
    centroid = point(value['centroid']),
    areaMm2 = positive(value['areaMm2']);
  const shape = value['shape'],
    headingDeg = value['headingDeg'] === null ? null : heading(value['headingDeg']);
  if (
    outline === undefined ||
    rect === undefined ||
    centroid === undefined ||
    areaMm2 === undefined ||
    headingDeg === undefined
  )
    return undefined;
  if (!validShape(shape) || typeof value['partial'] !== 'boolean') return undefined;
  return {
    outline,
    rect,
    centroid,
    areaMm2,
    shape,
    headingDeg,
    partial: value['partial'],
  };
}
function normalizeOutline(value: unknown): ReadonlyArray<Vec2> | undefined {
  if (!Array.isArray(value) || value.length < 3 || value.length > FIXTURE_LIMITS.outlinePoints)
    return undefined;
  const points = value.map(point);
  return points.some((item) => item === undefined) ? undefined : (points as Vec2[]);
}
function normalizeRect(value: Record<string, unknown>): DetectedPiece['rect'] | undefined {
  const centre = point(value['centre']),
    axisDeg = finite(value['axisDeg']),
    length = positive(value['length']),
    width = positive(value['width']);
  if (centre === undefined || axisDeg === undefined || length === undefined || width === undefined)
    return undefined;
  return axisDeg < 0 || axisDeg >= 180 || width > length
    ? undefined
    : { centre, axisDeg, length, width };
}
function validShape(value: unknown): value is DetectedPiece['shape'] {
  return value === 'round' || value === 'square' || value === 'oblong';
}
function heading(value: unknown): number | undefined {
  const angle = finite(value);
  return angle !== undefined && angle >= 0 && angle < 360 ? angle : undefined;
}
function normalizeSample(
  value: unknown,
  slots: FixtureTemplate['slots'],
): FixtureTemplate['sample'] | null {
  if (value === undefined) return undefined;
  if (!record(value)) return null;
  const slotId = text(value['slotId'], 160),
    design = normalizeDesign(value['design']);
  return slotId === undefined || design === undefined || !slots.some((slot) => slot.id === slotId)
    ? null
    : { slotId, design };
}
function normalizeDesign(value: unknown): DesignFrame | undefined {
  if (!record(value)) return undefined;
  const centre = point(value['centre']),
    width = positive(value['width']),
    height = positive(value['height']),
    turnDeg = finite(value['turnDeg']);
  return centre === undefined ||
    width === undefined ||
    height === undefined ||
    turnDeg === undefined
    ? undefined
    : { centre, width, height, turnDeg };
}
function normalizeCamera(value: unknown): FixtureCameraContext | undefined {
  if (!record(value)) return undefined;
  const model = normalizeCameraModelRecord(value['model']),
    surfaceHeightMm = nonNegative(value['surfaceHeightMm']),
    heightAreas = normalizeAreas(value['heightAreas']);
  return model === undefined || surfaceHeightMm === undefined || heightAreas === undefined
    ? undefined
    : { model, surfaceHeightMm, heightAreas };
}
function normalizeAreas(value: unknown): ReadonlyArray<SurfaceHeightArea> | undefined {
  if (!Array.isArray(value) || value.length > FIXTURE_LIMITS.heightAreas) return undefined;
  const areas: SurfaceHeightArea[] = [];
  for (const item of value) {
    if (!record(item)) return undefined;
    const id = text(item['id'], 160),
      x = finite(item['x']),
      y = finite(item['y']),
      width = positive(item['width']),
      height = positive(item['height']),
      surfaceHeightMm = nonNegative(item['surfaceHeightMm']);
    if (
      id === undefined ||
      x === undefined ||
      y === undefined ||
      width === undefined ||
      height === undefined ||
      surfaceHeightMm === undefined
    )
      return undefined;
    areas.push({ id, x, y, width, height, surfaceHeightMm });
  }
  return new Set(areas.map((area) => area.id)).size === areas.length ? areas : undefined;
}
export function normalizeQualification(value: unknown): FixtureQualification | undefined {
  if (!record(value) || value['method'] !== 'manual-observation') return undefined;
  const recordedAt = timestamp(value['recordedAt']),
    notes = text(value['notes'], 2000, true),
    basis = normalizeBasis(value['basis']);
  const camera =
    value['camera'] === undefined ? undefined : (normalizeCamera(value['camera']) ?? null);
  const points = normalizeObservationPoints(value['points']);
  if (
    recordedAt === undefined ||
    notes === undefined ||
    basis === undefined ||
    camera === null ||
    points === undefined
  )
    return undefined;
  return {
    recordedAt,
    notes,
    basis,
    ...(camera === undefined ? {} : { camera }),
    method: 'manual-observation',
    points,
  };
}
function normalizeObservationPoints(value: unknown): FixtureQualification['points'] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > FIXTURE_LIMITS.observations)
    return undefined;
  const points: FixtureQualification['points'][number][] = [];
  for (const item of value) {
    if (!record(item)) return undefined;
    const expectedMm = point(item['expectedMm']),
      observedMm = point(item['observedMm']);
    if (expectedMm === undefined || observedMm === undefined) return undefined;
    points.push({ expectedMm, observedMm });
  }
  return points;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000
    ? value
    : undefined;
}
function positive(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number > 0 ? number : undefined;
}
function nonNegative(value: unknown): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= 0 ? number : undefined;
}
function point(value: unknown): Vec2 | undefined {
  if (!record(value)) return undefined;
  const x = finite(value['x']),
    y = finite(value['y']);
  return x === undefined || y === undefined ? undefined : { x, y };
}
function text(value: unknown, limit: number, empty = false): string | undefined {
  return typeof value === 'string' && value.length <= limit && (empty || value.trim().length > 0)
    ? value
    : undefined;
}
function timestamp(value: unknown): string | undefined {
  return typeof value === 'string' &&
    value.length <= 64 &&
    /^\d{4}-\d\d-\d\dT/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : undefined;
}
function withinBytes(value: unknown, limit: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && new TextEncoder().encode(serialized).byteLength <= limit;
  } catch {
    return false;
  }
}
