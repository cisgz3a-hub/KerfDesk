import type { LibraryEntry } from './design-library-types';

export function validateDesignLibraryCatalog(entries: ReadonlyArray<LibraryEntry>): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id)) issues.push(`${entry.id}: invalid id`);
    if (ids.has(entry.id)) issues.push(`${entry.id}: duplicate id`);
    ids.add(entry.id);
    if (entry.title.trim() === '') issues.push(`${entry.id}: missing title`);
    if (entry.subcategory.trim() === '') issues.push(`${entry.id}: missing subcategory`);
    if (entry.machineModes.length === 0) issues.push(`${entry.id}: missing machine modes`);
    if (entry.operations.length === 0) issues.push(`${entry.id}: missing operations`);
    if (entry.tags.length === 0) issues.push(`${entry.id}: missing tags`);
    if (entry.previewSvgText.trim() === '') issues.push(`${entry.id}: missing preview SVG`);
    if (entry.provenance.license.trim() === '') issues.push(`${entry.id}: missing license`);
    if (entry.provenance.sourceKind !== 'owned' && entry.provenance.sourceUrl === undefined) {
      issues.push(`${entry.id}: missing external source URL`);
    }
    if (
      (entry.provenance.sourceKind === 'cc0' || entry.provenance.sourceKind === 'public-domain') &&
      (entry.provenance.downloadedAt === undefined || entry.provenance.assetHash === undefined)
    ) {
      issues.push(`${entry.id}: missing public-domain provenance`);
    }
    if (entry.insert.kind === 'svg' && entry.insert.svgText.trim() === '') {
      issues.push(`${entry.id}: missing SVG insert text`);
    }
  }
  return issues;
}
