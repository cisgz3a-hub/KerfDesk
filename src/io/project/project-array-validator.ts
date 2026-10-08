import { z } from 'zod';
import { readProjectArchive, validateArchiveProjectValue } from './project-archive-shape';

const id = z.string().min(1).max(200);
const finite = z.number().finite();
const count = z.number().int().min(1).max(10_000);
const axes = z.enum(['none', 'horizontal', 'vertical', 'both']);
const spec = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('grid'),
      rows: count,
      columns: count,
      spacingX: finite.nonnegative(),
      spacingY: finite.nonnegative(),
      spaceBy: z.enum(['gap', 'centres']).optional(),
      rowShift: finite.optional(),
      columnShift: finite.optional(),
      reverseColumns: z.boolean().optional(),
      reverseRows: z.boolean().optional(),
      mirrorColumns: axes.optional(),
      mirrorRows: axes.optional(),
    })
    .refine((value) => value.rows * value.columns <= 10_000),
  z.object({
    kind: z.literal('circular'),
    count,
    centerX: finite,
    centerY: finite,
    radius: finite.nonnegative(),
    startAngleDeg: finite,
    rotateCopies: z.boolean(),
    centerObjectId: id.optional(),
    arc: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('end'), endAngleDeg: finite }),
        z.object({ kind: z.literal('step'), stepAngleDeg: finite }),
      ])
      .optional(),
  }),
  z.object({ kind: z.literal('point-rotation'), count, totalAngleDeg: finite }),
]);
const layouts = z
  .array(
    z.object({
      id,
      name: id,
      spec,
      sourceIds: z.array(id).min(1).max(10_000),
      instances: z
        .array(z.object({ id, sourceToObject: z.record(id, id) }))
        .min(1)
        .max(10_000),
      ownedObjectIds: z.array(id).min(1).max(10_000),
      sourceProjectJson: z.string().min(1).max(50_000_000),
      baselineProjectJson: z.string().min(1).max(50_000_000),
      evaluationTime: z.string().datetime().optional(),
      advanceVariables: z.boolean().optional(),
    }),
  )
  .max(32);

export function validateRetainedArrays(
  value: unknown,
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  if (value === undefined) return null;
  const parsed = layouts.safeParse(value);
  if (!parsed.success) return 'Invalid retained array layout';
  if (new Set(parsed.data.map((layout) => layout.id)).size !== parsed.data.length)
    return 'Duplicate retained array identity';
  if (
    parsed.data.reduce(
      (total, layout) =>
        total + layout.sourceProjectJson.length + layout.baselineProjectJson.length,
      0,
    ) > 50_000_000
  )
    return 'Retained array archives exceed 50 MB; expand copies or use another sheet';
  for (const layout of parsed.data) {
    const error = validateLayout(layout, validate);
    if (error !== null) return error;
  }
  const owned = parsed.data.flatMap((layout) => layout.ownedObjectIds);
  if (new Set(owned).size !== owned.length) return 'Retained arrays cannot own the same object';
  return null;
}

type LayoutInput = z.infer<typeof layouts>[number];
function validateLayout(
  layout: LayoutInput,
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  if (
    layout.instances.length !==
    (layout.spec.kind === 'grid' ? layout.spec.rows * layout.spec.columns : layout.spec.count)
  )
    return 'Array instance count differs from its settings';
  const source = readProjectArchive(layout.sourceProjectJson, [
    'sheetBook',
    'productionManifest',
    'arrayLayouts',
  ]);
  const baseline = readProjectArchive(layout.baselineProjectJson, [
    'sheetBook',
    'productionManifest',
    'arrayLayouts',
  ]);
  if (!source.ok) return `Invalid array source: ${source.reason}`;
  if (!baseline.ok) return `Invalid array baseline: ${baseline.reason}`;
  const error =
    validateArchiveProjectValue(source.raw, validate) ??
    validateArchiveProjectValue(baseline.raw, validate);
  if (error !== null) return `Invalid array archive: ${error}`;
  const sources = archiveObjectIds(source.raw);
  const members = archiveObjectIds(baseline.raw);
  return sources === null || members === null
    ? 'Missing array archive objects'
    : validateLayoutIdentities(layout, sources, members);
}
function validateLayoutIdentities(
  layout: LayoutInput,
  sources: ReadonlySet<string>,
  baseline: ReadonlySet<string>,
): string | null {
  if (
    new Set(layout.ownedObjectIds).size !== layout.ownedObjectIds.length ||
    new Set(layout.instances.map((entry) => entry.id)).size !== layout.instances.length
  )
    return 'Duplicate array member identity';
  const memberIds = layout.instances.flatMap((instance) => Object.values(instance.sourceToObject));
  const members = new Set(memberIds);
  if (
    members.size !== memberIds.length ||
    members.size !== baseline.size ||
    memberIds.some((id) => !baseline.has(id))
  )
    return 'Array baseline differs from its instance identities';
  if (layout.ownedObjectIds.some((id) => !members.has(id)))
    return 'Array owns an object outside its instances';
  if (
    new Set(layout.sourceIds).size !== layout.sourceIds.length ||
    layout.sourceIds.some((id) => !sources.has(id))
  )
    return 'Missing or duplicate array source identity';
  if (
    layout.instances.some(
      (instance) =>
        Object.keys(instance.sourceToObject).length !== sources.size ||
        Object.keys(instance.sourceToObject).some((id) => !sources.has(id)),
    )
  )
    return 'Array instance has missing or unknown source objects';
  return null;
}
function archiveObjectIds(raw: Record<string, unknown>): ReadonlySet<string> | null {
  const scene = raw['scene'];
  if (
    typeof scene !== 'object' ||
    scene === null ||
    !('objects' in scene) ||
    !Array.isArray(scene.objects)
  )
    return null;
  return new Set(
    scene.objects.flatMap((object) =>
      typeof object === 'object' && object !== null && typeof object.id === 'string'
        ? [object.id]
        : [],
    ),
  );
}
