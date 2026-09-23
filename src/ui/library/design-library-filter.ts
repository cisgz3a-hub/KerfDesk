import type {
  LibraryEntry,
  LibraryEntryKind,
  LibraryMachineMode,
  LibraryOperation,
  LibrarySourceKind,
} from './design-library-types';

export type LibraryFilters = {
  readonly search?: string;
  readonly category?: LibraryEntry['category'] | 'all';
  readonly machine?: LibraryMachineMode | 'all';
  readonly kind?: LibraryEntryKind | 'all';
  readonly operation?: LibraryOperation | 'all';
  readonly sourceKind?: LibrarySourceKind | 'all';
};

export function filterDesignLibrary(
  entries: ReadonlyArray<LibraryEntry>,
  filters: LibraryFilters,
): LibraryEntry[] {
  const query = filters.search?.trim().toLowerCase() ?? '';
  return entries
    .filter(
      (entry) =>
        filters.category === undefined ||
        filters.category === 'all' ||
        entry.category === filters.category,
    )
    .filter(
      (entry) =>
        filters.machine === undefined ||
        filters.machine === 'all' ||
        entry.machineModes.includes(filters.machine),
    )
    .filter(
      (entry) =>
        filters.kind === undefined || filters.kind === 'all' || entry.kind === filters.kind,
    )
    .filter(
      (entry) =>
        filters.operation === undefined ||
        filters.operation === 'all' ||
        entry.operations.includes(filters.operation),
    )
    .filter(
      (entry) =>
        filters.sourceKind === undefined ||
        filters.sourceKind === 'all' ||
        entry.provenance.sourceKind === filters.sourceKind,
    )
    .filter(
      (entry) => query === '' || haystack(entry).includes(query) || ownCreditMatches(entry, query),
    )
    .slice()
    .sort((a, b) => `${a.category}\u0000${a.title}`.localeCompare(`${b.category}\u0000${b.title}`));
}

function haystack(entry: LibraryEntry): string {
  const provenance = entry.provenance;
  const credit =
    provenance.sourceKind === 'owned' ? [] : [provenance.creator, provenance.sourceName];
  return searchText([
    entry.title,
    entry.category,
    entry.subcategory,
    ...entry.tags,
    ...credit,
    provenance.license,
    provenance.licenseId,
  ]);
}

// Originals credit KerfDesk itself, and "kerf" is a laser term: a substring
// match would answer a kerf search with every original. That credit matches
// whole words only, so "kerfdesk" finds the originals and "kerf" does not.
function ownCreditMatches(entry: LibraryEntry, query: string): boolean {
  const provenance = entry.provenance;
  if (provenance.sourceKind !== 'owned') return false;
  const credit = searchText([provenance.sourceName, provenance.creator]);
  return ` ${credit} `.includes(` ${query.split(/\s+/u).join(' ')} `);
}

function searchText(values: ReadonlyArray<string | undefined>): string {
  return values
    .filter((value): value is string => value !== undefined)
    .join(' ')
    .toLowerCase();
}
