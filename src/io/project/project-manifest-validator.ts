import { z } from 'zod';
import { readProjectArchive, validateProjectArchive } from './project-archive-shape';

const id = z.string().min(1).max(200);
const time = z.string().datetime();
const schema = z.object({
  id,
  name: id,
  frozenAt: time,
  designProjectJson: z.string().min(1).max(50_000_000),
  activeRowId: id.optional(),
  rows: z
    .array(
      z.object({
        id,
        index: z.number().int().min(0).max(499),
        recordIndex: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        serialValue: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        values: z.array(z.string().max(100_000)).max(1000),
        status: z.enum(['pending', 'reviewed', 'completed', 'skipped', 'failed', 'uncertain']),
        notes: z.string().max(10_000),
        reviewedProjectJson: z.string().min(1).max(50_000_000).optional(),
        reviewedAt: time.optional(),
        resultAt: time.optional(),
      }),
    )
    .min(1)
    .max(500),
});

export function validateProductionManifest(
  value: unknown,
  validate: (raw: Record<string, unknown>) => string | null,
): string | null {
  if (value === undefined) return null;
  const parsed = schema.safeParse(value);
  if (!parsed.success) return 'Invalid production manifest';
  const manifest = parsed.data;
  const identityError = validateManifestIdentity(manifest);
  if (identityError !== null) return identityError;
  const jsons = [
    manifest.designProjectJson,
    ...manifest.rows.flatMap((row) =>
      row.reviewedProjectJson === undefined ? [] : [row.reviewedProjectJson],
    ),
  ];
  if (jsons.reduce((total, json) => total + json.length, 0) > 50_000_000)
    return 'Production variants exceed 50 MB; archive a separate run';
  for (const json of jsons) {
    const error = validateProjectArchive(json, ['sheetBook', 'productionManifest'], validate);
    if (error !== null) return `Invalid production variant: ${error}`;
  }
  const design = readProjectArchive(manifest.designProjectJson, [
    'sheetBook',
    'productionManifest',
  ]);
  if (!design.ok) return design.reason;
  for (const row of manifest.rows) {
    const error = validateProductionRow(row, design.raw);
    if (error !== null) return error;
  }
  return null;
}

type ManifestRowInput = z.infer<typeof schema>['rows'][number];
function validateManifestIdentity(manifest: z.infer<typeof schema>): string | null {
  const ids = new Set(manifest.rows.map((row) => row.id));
  if (ids.size !== manifest.rows.length || manifest.rows.some((row, index) => row.index !== index))
    return 'Invalid production row identity or order';
  return manifest.activeRowId !== undefined && !ids.has(manifest.activeRowId)
    ? 'Missing active production row'
    : null;
}
function validateProductionRow(
  row: ManifestRowInput,
  design: Record<string, unknown>,
): string | null {
  const hasVariant = row.reviewedProjectJson !== undefined;
  if (hasVariant !== (row.reviewedAt !== undefined))
    return 'Production variant and capture time must be recorded together';
  if ((row.status === 'reviewed' || row.status === 'completed') && !hasVariant)
    return 'Reviewed and completed rows require a captured variant';
  const records = designCsvRecords(design);
  const values = records === null ? [] : records[row.recordIndex];
  if (values === undefined || JSON.stringify(values) !== JSON.stringify(row.values))
    return 'Production row values differ from the frozen CSV record';
  if (row.reviewedProjectJson === undefined) return null;
  const loaded = readProjectArchive(row.reviewedProjectJson, ['sheetBook', 'productionManifest']);
  return loaded.ok && hasLiveVariableObjects(loaded.raw)
    ? 'A reviewed production variant must contain fixed text and barcode values'
    : null;
}
function designCsvRecords(design: Record<string, unknown>): unknown[] | null {
  const variables = design['variables'];
  if (typeof variables !== 'object' || variables === null || !('csv' in variables)) return null;
  const csv = variables.csv;
  return typeof csv === 'object' && csv !== null && 'records' in csv && Array.isArray(csv.records)
    ? csv.records
    : null;
}
function hasLiveVariableObjects(raw: Record<string, unknown>): boolean {
  const scene = raw['scene'];
  if (
    typeof scene !== 'object' ||
    scene === null ||
    !('objects' in scene) ||
    !Array.isArray(scene.objects)
  )
    return false;
  return scene.objects.some((object) => {
    if (typeof object !== 'object' || object === null) return false;
    if (object.kind === 'text') return object.variableTemplate !== undefined;
    return (
      object.kind === 'shape' &&
      object.spec?.kind === 'barcode' &&
      object.spec.variableTemplate !== undefined
    );
  });
}
