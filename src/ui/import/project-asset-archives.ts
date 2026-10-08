import type { Project } from '../../core/scene';
import type { ProductionManifest } from '../../core/scene/production-manifest';
import type { RetainedArrayLayout } from '../../core/scene/retained-array';

export type ProjectAssetArchive = {
  readonly owner: object;
  readonly key: string;
  readonly label: string;
  readonly json: string;
  readonly kind: 'sheet' | 'production' | 'array';
};
export type ProjectAssetArchiveBudget = { remainingChars: number; remainingEntries: number };
export function projectAssetArchiveBudget(): ProjectAssetArchiveBudget {
  return { remainingChars: 50_000_000, remainingEntries: 50_100 };
}

/** The same bounded workflow fields feed portable copies and conservative asset retention. */
export function projectAssetArchives(project: object): ReadonlyArray<ProjectAssetArchive> {
  const raw = project as Record<string, unknown>;
  const entries: ProjectAssetArchive[] = [];
  const book = record(raw['sheetBook']);
  const inactive = book?.['inactive'];
  if (Array.isArray(inactive)) {
    if (inactive.length > 99) throw new Error('Too many archived project sheets.');
    for (const sheet of inactive) {
      const item = record(sheet);
      if (item !== null)
        addArchive(entries, item, 'projectJson', `Sheet ${String(item['name'])}`, 'sheet');
    }
  }
  const manifest = record(raw['productionManifest']);
  if (manifest !== null) addProductionArchives(entries, manifest);
  addArrayArchives(entries, raw['arrayLayouts']);
  return entries;
}

function addArrayArchives(entries: ProjectAssetArchive[], value: unknown): void {
  if (!Array.isArray(value)) return;
  if (value.length > 32) throw new Error('Too many retained array layouts.');
  for (const layout of value) {
    const item = record(layout);
    if (item === null) continue;
    addArchive(entries, item, 'sourceProjectJson', `Array ${String(item['name'])} source`, 'array');
    addArchive(
      entries,
      item,
      'baselineProjectJson',
      `Array ${String(item['name'])} baseline`,
      'array',
    );
  }
}

function addProductionArchives(
  entries: ProjectAssetArchive[],
  manifest: Record<string, unknown>,
): void {
  addArchive(entries, manifest, 'designProjectJson', 'Production design', 'production');
  const rows = manifest['rows'];
  if (!Array.isArray(rows)) return;
  if (rows.length > 500) throw new Error('Too many archived production rows.');
  for (const row of rows) {
    const item = record(row);
    if (item !== null)
      addArchive(
        entries,
        item,
        'reviewedProjectJson',
        `Production row ${String(item['index'])}`,
        'production',
      );
  }
}

function addArchive(
  entries: ProjectAssetArchive[],
  owner: Record<string, unknown>,
  key: string,
  label: string,
  kind: ProjectAssetArchive['kind'],
): void {
  const json = owner[key];
  if (typeof json === 'string') entries.push({ owner, key, label, json, kind });
}

export function readProjectAssetArchive(
  entry: ProjectAssetArchive,
  budget: ProjectAssetArchiveBudget,
): Record<string, unknown> {
  budget.remainingChars -= entry.json.length;
  budget.remainingEntries--;
  if (budget.remainingChars < 0 || budget.remainingEntries < 0)
    throw new Error('Workflow project archives exceed the 50 million character copy budget.');
  const raw = record(JSON.parse(entry.json));
  if (raw === null) throw new Error(`${entry.label} is not a project document.`);
  if (raw['sheetBook'] !== undefined)
    throw new Error('Nested project sheet books are not supported.');
  if (entry.kind !== 'sheet' && raw['productionManifest'] !== undefined)
    throw new Error('Recursive production archives are not supported.');
  if (entry.kind === 'array' && raw['arrayLayouts'] !== undefined)
    throw new Error('Recursive array archives are not supported.');
  return raw;
}

export async function mapProjectAssetArchives(
  project: Project,
  transform: (entry: ProjectAssetArchive) => Promise<string>,
): Promise<Project> {
  const replacements = new Map<object, Map<string, string>>();
  for (const entry of projectAssetArchives(project)) {
    const fields = replacements.get(entry.owner) ?? new Map<string, string>();
    fields.set(entry.key, await transform(entry));
    replacements.set(entry.owner, fields);
  }
  const book = project.sheetBook;
  const manifest = project.productionManifest;
  return {
    ...project,
    ...(book === undefined
      ? {}
      : {
          sheetBook: {
            ...book,
            inactive: book.inactive.map((sheet) => ({
              ...sheet,
              projectJson: replacement(replacements, sheet, 'projectJson', sheet.projectJson),
            })),
          },
        }),
    ...(manifest === undefined
      ? {}
      : { productionManifest: replacedManifest(manifest, replacements) }),
    ...(project.arrayLayouts === undefined
      ? {}
      : {
          arrayLayouts: project.arrayLayouts.map((layout) => replacedArray(layout, replacements)),
        }),
  };
}

function replacedArray(
  layout: RetainedArrayLayout,
  values: Map<object, Map<string, string>>,
): RetainedArrayLayout {
  return {
    ...layout,
    sourceProjectJson: replacement(values, layout, 'sourceProjectJson', layout.sourceProjectJson),
    baselineProjectJson: replacement(
      values,
      layout,
      'baselineProjectJson',
      layout.baselineProjectJson,
    ),
  };
}

function replacedManifest(
  manifest: ProductionManifest,
  values: Map<object, Map<string, string>>,
): ProductionManifest {
  return {
    ...manifest,
    designProjectJson: replacement(
      values,
      manifest,
      'designProjectJson',
      manifest.designProjectJson,
    ),
    rows: manifest.rows.map((row) => ({
      ...row,
      ...(row.reviewedProjectJson === undefined
        ? {}
        : {
            reviewedProjectJson: replacement(
              values,
              row,
              'reviewedProjectJson',
              row.reviewedProjectJson,
            ),
          }),
    })),
  };
}
function replacement(
  values: Map<object, Map<string, string>>,
  owner: object,
  key: string,
  fallback: string,
): string {
  return values.get(owner)?.get(key) ?? fallback;
}
function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
