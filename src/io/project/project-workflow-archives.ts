const MAX_ARCHIVE_CHARS = 50_000_000;
const MAX_ARCHIVE_ENTRIES = 50_100;

/** Bounded work across sheets, production designs/variants and retained-array snapshots. */
export function visitWorkflowArchives(
  root: object,
  visit: (raw: Record<string, unknown>) => void = () => undefined,
): string | null {
  const pending = archiveStrings(root);
  let remaining = MAX_ARCHIVE_CHARS;
  let entries = MAX_ARCHIVE_ENTRIES;
  for (const json of pending) {
    remaining -= json.length;
    entries--;
    if (remaining < 0 || entries < 0)
      return 'Workflow project archives exceed the 50 million character budget';
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return 'Invalid workflow project archive JSON';
    }
    const record = objectRecord(raw);
    if (record === null) return 'Invalid workflow project archive';
    visit(record);
    pending.push(...archiveStrings(record));
  }
  return null;
}

function archiveStrings(value: object): string[] {
  const raw = value as Record<string, unknown>;
  const sheets = objectRecord(raw['sheetBook']);
  const manifest = objectRecord(raw['productionManifest']);
  return [
    ...arrayRecords(sheets?.['inactive']).flatMap((sheet) => stringField(sheet, 'projectJson')),
    ...stringField(manifest, 'designProjectJson'),
    ...arrayRecords(manifest?.['rows']).flatMap((row) => stringField(row, 'reviewedProjectJson')),
    ...arrayRecords(raw['arrayLayouts']).flatMap((layout) => [
      ...stringField(layout, 'sourceProjectJson'),
      ...stringField(layout, 'baselineProjectJson'),
    ]),
  ];
}
function stringField(value: Record<string, unknown> | null, field: string): string[] {
  const entry = value?.[field];
  return typeof entry === 'string' ? [entry] : [];
}
function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const record = objectRecord(entry);
        return record === null ? [] : [record];
      })
    : [];
}
function objectRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
