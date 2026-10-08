import {
  projectAssetArchives,
  projectAssetArchiveBudget,
  readProjectAssetArchive,
  type ProjectAssetArchive,
  type ProjectAssetArchiveBudget,
} from './project-asset-archives';

type CachedArchive = { ids: ReadonlySet<string>; chars: number; entries: number };
const archiveCache = new WeakMap<object, Map<string, CachedArchive>>();

/** Conservative retention only: inspect references without admitting or executing an archive. */
export function projectArchiveAssetIds(project: object): ReadonlySet<string> {
  const ids = new Set<string>();
  collectArchives(project, ids, projectAssetArchiveBudget());
  return ids;
}

function collectArchives(
  project: object,
  ids: Set<string>,
  budget: ProjectAssetArchiveBudget,
): void {
  try {
    for (const entry of projectAssetArchives(project))
      for (const id of archivedAssetIds(entry, budget)) ids.add(id);
  } catch {
    /* Admission reports invalid archives; retention never mutates them. */
  }
}

function archivedAssetIds(
  entry: ProjectAssetArchive,
  budget: ProjectAssetArchiveBudget,
): ReadonlySet<string> {
  const fields = archiveCache.get(entry.owner) ?? new Map<string, CachedArchive>();
  const cached = fields.get(entry.key);
  if (cached !== undefined) {
    budget.remainingChars -= cached.chars;
    budget.remainingEntries -= cached.entries;
    if (budget.remainingChars < 0 || budget.remainingEntries < 0) return new Set();
    return cached.ids;
  }
  const startChars = budget.remainingChars;
  const startEntries = budget.remainingEntries;
  const ids = new Set<string>();
  try {
    const raw = readProjectAssetArchive(entry, budget);
    for (const object of sheetObjects(raw)) addObjectAssetIds(object, ids);
    collectArchives(raw, ids, budget);
  } catch {
    // Document admission reports corrupt archives. Retention never mutates them.
  }
  fields.set(entry.key, {
    ids,
    chars: startChars - budget.remainingChars,
    entries: startEntries - budget.remainingEntries,
  });
  archiveCache.set(entry.owner, fields);
  return ids;
}

function sheetObjects(raw: unknown): ReadonlyArray<unknown> {
  const scene = record(raw)?.['scene'];
  const objects = record(scene)?.['objects'];
  return Array.isArray(objects) ? objects : [];
}

function addObjectAssetIds(object: unknown, ids: Set<string>): void {
  const item = record(object);
  if (item?.['kind'] !== 'raster-image') return;
  const asset = record(item['imageAsset']);
  if (asset?.['repository'] !== 'curvedesk-import-assets-v1') return;
  for (const key of ['sourceAssetId', 'lumaAssetId']) {
    const id = asset[key];
    if (typeof id === 'string' && id !== '') ids.add(id);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
