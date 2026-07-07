import type { LibraryEntry } from './design-library-types';

export function validateDesignLibraryCatalog(entries: ReadonlyArray<LibraryEntry>): string[] {
  const issues: string[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    pushIssue(issues, !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id), `${entry.id}: invalid id`);
    pushIssue(issues, ids.has(entry.id), `${entry.id}: duplicate id`);
    ids.add(entry.id);
    pushRequiredFieldIssues(issues, entry);
    pushIssue(issues, missingExternalSource(entry), `${entry.id}: missing external source URL`);
    pushIssue(
      issues,
      missingPublicDomainProvenance(entry),
      `${entry.id}: missing public-domain provenance`,
    );
    pushIssue(issues, missingSvgText(entry), `${entry.id}: missing SVG insert text`);
  }
  return issues;
}

function pushRequiredFieldIssues(issues: string[], entry: LibraryEntry): void {
  pushIssue(issues, entry.title.trim() === '', `${entry.id}: missing title`);
  pushIssue(issues, entry.subcategory.trim() === '', `${entry.id}: missing subcategory`);
  pushIssue(issues, entry.machineModes.length === 0, `${entry.id}: missing machine modes`);
  pushIssue(issues, entry.operations.length === 0, `${entry.id}: missing operations`);
  pushIssue(issues, entry.tags.length === 0, `${entry.id}: missing tags`);
  pushIssue(issues, entry.previewSvgText.trim() === '', `${entry.id}: missing preview SVG`);
  pushIssue(issues, entry.provenance.license.trim() === '', `${entry.id}: missing license`);
}

function missingExternalSource(entry: LibraryEntry): boolean {
  return entry.provenance.sourceKind !== 'owned' && entry.provenance.sourceUrl === undefined;
}

function missingPublicDomainProvenance(entry: LibraryEntry): boolean {
  const publicDomain =
    entry.provenance.sourceKind === 'cc0' || entry.provenance.sourceKind === 'public-domain';
  return (
    publicDomain &&
    (entry.provenance.downloadedAt === undefined || entry.provenance.assetHash === undefined)
  );
}

function missingSvgText(entry: LibraryEntry): boolean {
  return entry.insert.kind === 'svg' && entry.insert.svgText.trim() === '';
}

function pushIssue(issues: string[], failed: boolean, issue: string): void {
  if (failed) issues.push(issue);
}
