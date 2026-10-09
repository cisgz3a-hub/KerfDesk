import { reliefCompositionWork, reliefStrokeSampleWork } from './relief-authoring-work';
import { reliefRailProfileError } from './relief-rail-profile-validation';
import {
  RELIEF_AUTHORING_MAX_CELLS,
  RELIEF_AUTHORING_MAX_COMPONENTS,
  RELIEF_AUTHORING_MAX_STROKES,
  RELIEF_AUTHORING_MAX_WORK,
} from '../scene/relief/relief-authoring';
import type {
  ReliefAuthoringDocument,
  ReliefSculptStroke,
  ReliefVectorMask,
} from '../scene/relief/relief-authoring';
import { reliefBoundaryError } from './relief-vector-boundary';
import { reliefStrokeDabs } from './relief-sculpt';

type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const positive = (v: unknown): v is number => finite(v) && v > 0;
const integer = (v: unknown): v is number => positive(v) && Number.isSafeInteger(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024;
const all = (values: readonly boolean[]): boolean => values.every(Boolean);
const pointValid = (v: unknown): boolean => record(v) && all([finite(v['x']), finite(v['y'])]);
const firstError = (values: readonly (string | null)[]): string | null =>
  values.find((v) => v !== null) ?? null;
const requirement = (valid: boolean, error: string): string | null => (valid ? null : error);

/** Admission bounds field storage, geometry, stroke dabs and total raster work. */
export function reliefAuthoringError(value: unknown): string | null {
  if (!record(value)) return 'Missing retained relief document.';
  const header = headerError(value);
  if (header !== null) return header;
  const levels = value['levels'],
    components = value['components'],
    strokes = value['strokes'];
  if (!Array.isArray(levels) || !Array.isArray(components) || !Array.isArray(strokes))
    return 'Missing relief levels, components or strokes.';
  const limits = collectionError(value, levels, components, strokes);
  if (limits !== null) return limits;
  const levelIds = new Set<string>(),
    componentIds = new Set<string>(),
    strokeIds = new Set<string>();
  for (const level of levels) {
    const error = levelError(level, levelIds);
    if (error !== null) return error;
  }
  for (const component of components) {
    const error = componentError(component, levelIds, componentIds, value['algorithmRevision']);
    if (error !== null) return error;
  }
  return firstError([
    strokeCollectionError(strokes, value, componentIds, strokeIds),
    optionalMaskError(value['clip']),
  ]);
}
function headerError(v: RecordValue): string | null {
  const shape = firstError([
    requirement(
      v['schemaVersion'] === 1 &&
        (v['algorithmRevision'] === 'retained-relief-v1' ||
          v['algorithmRevision'] === 'retained-relief-v2'),
      'Unsupported retained relief document.',
    ),
    requirement(
      finite(v['revision']) && Number.isSafeInteger(v['revision']) && v['revision'] >= 0,
      'Invalid relief revision.',
    ),
    requirement(
      integer(v['width']) && integer(v['height']),
      'Relief grid requires positive integer dimensions.',
    ),
    requirement(
      all([
        positive(v['physicalWidthMm']),
        positive(v['physicalHeightMm']),
        positive(v['maxDepthMm']),
        finite(v['baselineHeightMm']),
      ]),
      'Relief dimensions, depth and baseline must be finite millimetres.',
    ),
    requirement(
      ['stock-top', 'relief-floor', 'excluded'].includes(String(v['outsideMask'])),
      'Invalid relief outside-mask meaning.',
    ),
  ]);
  if (shape !== null) return shape;
  const width = v['width'] as number,
    height = v['height'] as number,
    baseline = v['baselineHeightMm'] as number;
  return firstError([
    requirement(
      width * height <= RELIEF_AUTHORING_MAX_CELLS,
      'Retained relief grid exceeds 1,048,576 cells; choose an explicit smaller authoring grid.',
    ),
    requirement(
      baseline >= 0 && baseline <= (v['maxDepthMm'] as number),
      'Baseline must lie between relief floor and stock top.',
    ),
  ]);
}
function collectionError(
  v: RecordValue,
  levels: unknown[],
  components: unknown[],
  strokes: unknown[],
): string | null {
  return firstError([
    requirement(
      all([
        levels.length > 0,
        levels.length <= 64,
        components.length <= RELIEF_AUTHORING_MAX_COMPONENTS,
        strokes.length <= RELIEF_AUTHORING_MAX_STROKES,
      ]),
      'Relief level, component or stroke limit exceeded.',
    ),
    requirement(
      reliefCompositionWork(v) <= RELIEF_AUTHORING_MAX_WORK,
      'Composition exceeds the declared work budget; reduce grid size or components explicitly.',
    ),
  ]);
}
function levelError(v: unknown, ids: Set<string>): string | null {
  if (!record(v)) return 'Invalid relief level.';
  if (
    !all([
      text(v['id']),
      text(v['name']),
      typeof v['visible'] === 'boolean',
      !ids.has(String(v['id'])),
    ])
  )
    return 'Invalid or duplicate relief level.';
  ids.add(v['id'] as string);
  return optionalMaskError(v['mask']);
}
function componentError(
  v: unknown,
  levels: Set<string>,
  ids: Set<string>,
  algorithmRevision: unknown,
): string | null {
  if (!record(v)) return 'Invalid relief component.';
  const meta = all([
    text(v['id']),
    !ids.has(String(v['id'])),
    text(v['name']),
    text(v['levelId']),
    levels.has(String(v['levelId'])),
    typeof v['visible'] === 'boolean',
  ]);
  if (!meta) return 'Invalid or duplicate relief component.';
  ids.add(v['id'] as string);
  const parameters = all([
    ['add', 'subtract', 'max', 'min', 'replace'].includes(String(v['combineMode'])),
    finite(v['baseHeightMm']),
    positive(v['heightScale']),
    transformValid(v['transform']),
  ]);
  return firstError([
    requirement(parameters, 'Invalid component mode, height or physical transform.'),
    optionalMaskError(v['mask']),
    sourceError(v['source'], algorithmRevision),
  ]);
}
function sourceError(v: unknown, algorithmRevision: unknown): string | null {
  if (!record(v)) return 'Missing relief component source.';
  if (v['kind'] === 'retained-field-v1') return retainedFieldSizeError(v['field']);
  if (v['kind'] === 'rail-profile-v1')
    return reliefRailProfileError(v, algorithmRevision === 'retained-relief-v1');
  const height = v['heightMm'];
  const valid = all([
    v['kind'] === 'vector-shape-v1',
    ['plane', 'dome', 'slope'].includes(String(v['profile'])),
    finite(height) && height >= 0,
    finite(v['angleDeg']),
  ]);
  if (!valid) return 'Unsupported single-valued relief generator.';
  return maskErrorFor(v['boundary'], false);
}
function retainedFieldSizeError(v: unknown): string | null {
  if (!record(v) || !integer(v['width']) || !integer(v['height']))
    return 'Invalid retained source field size.';
  return requirement(
    v['kind'] === 'heightfield-v1' && v['width'] * v['height'] <= RELIEF_AUTHORING_MAX_CELLS,
    'Retained source exceeds the bounded authoring field size.',
  );
}
function strokeCollectionError(
  strokes: unknown[],
  doc: RecordValue,
  components: Set<string>,
  ids: Set<string>,
): string | null {
  let pointCount = 0,
    work = reliefCompositionWork(doc);
  for (const raw of strokes) {
    const error = strokeError(raw, doc['maxDepthMm'] as number, components, ids);
    if (error !== null) return error;
    const stroke = raw as ReliefSculptStroke;
    pointCount += stroke.points.length;
    if (pointCount > 262_144) return 'Relief stroke point budget exceeded.';
    try {
      const nx = Math.min(
        doc['width'] as number,
        Math.ceil(
          (stroke.diameterMm / (stroke.metricScaleX ?? 1) / (doc['physicalWidthMm'] as number)) *
            (doc['width'] as number),
        ) + 2,
      );
      const ny = Math.min(
        doc['height'] as number,
        Math.ceil(
          (stroke.diameterMm / (stroke.metricScaleY ?? 1) / (doc['physicalHeightMm'] as number)) *
            (doc['height'] as number),
        ) + 2,
      );
      work += reliefStrokeDabs(stroke).length * nx * ny * reliefStrokeSampleWork(stroke);
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'Invalid stroke work budget.';
    }
    if (!Number.isSafeInteger(work) || work > RELIEF_AUTHORING_MAX_WORK)
      return 'Sculpt stroke exceeds the declared work budget.';
  }
  return null;
}
function strokeError(
  v: unknown,
  depth: number,
  components: Set<string>,
  ids: Set<string>,
): string | null {
  if (!record(v)) return 'Invalid relief sculpt stroke.';
  const meta = all([
    v['schemaVersion'] === 1,
    text(v['id']),
    !ids.has(String(v['id'])),
    text(v['componentId']),
    components.has(String(v['componentId'])),
  ]);
  if (!meta) return 'Invalid stroke or missing selected component.';
  ids.add(v['id'] as string);
  const height = v['flattenHeightMm'],
    strength = v['strength'];
  const brush = all([
    ['add', 'remove', 'smooth', 'flatten'].includes(String(v['mode'])),
    positive(v['diameterMm']),
    positive(strength),
    finite(height) && height >= 0 && height <= depth,
    optionalPositive(v['metricScaleX']),
    optionalPositive(v['metricScaleY']),
  ]);
  if (!brush) return 'Invalid relief brush parameters or physical scale.';
  if (['smooth', 'flatten'].includes(String(v['mode'])) && (strength as number) > 1)
    return 'Smooth and flatten strength must be in (0,1].';
  const points = v['points'];
  if (
    !Array.isArray(points) ||
    !all([points.length > 0, points.length <= 16_384, points.every(pointValid)])
  )
    return 'Invalid or oversized stroke.';
  return optionalMaskError(v['region']);
}
function optionalPositive(v: unknown): boolean {
  return v === undefined || positive(v);
}
function optionalMaskError(v: unknown): string | null {
  return v === undefined ? null : maskErrorFor(v);
}
function maskErrorFor(v: unknown, allowEmpty = true): string | null {
  if (!record(v) || !Array.isArray(v['rings'])) return 'Invalid relief vector mask.';
  if (
    !all([
      v['rings'].length <= 128,
      v['linkedObjectId'] === undefined || text(v['linkedObjectId']),
      v['linkComponentTransform'] === undefined || transformValid(v['linkComponentTransform']),
      v['rings'].every(ringValid),
    ])
  )
    return 'Invalid relief mask geometry.';
  return reliefBoundaryError(v as ReliefVectorMask, allowEmpty);
}
function ringValid(v: unknown): boolean {
  return (
    record(v) &&
    typeof v['closed'] === 'boolean' &&
    Array.isArray(v['points']) &&
    v['points'].every(pointValid)
  );
}
function transformValid(v: unknown): boolean {
  return (
    record(v) &&
    all([
      finite(v['x']),
      finite(v['y']),
      positive(v['scaleX']),
      positive(v['scaleY']),
      finite(v['rotationDeg']),
      typeof v['mirrorX'] === 'boolean',
      typeof v['mirrorY'] === 'boolean',
    ])
  );
}
export function admittedReliefDocument(value: unknown): value is ReliefAuthoringDocument {
  return reliefAuthoringError(value) === null;
}
