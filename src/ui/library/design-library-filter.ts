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
    .filter((entry) => query === '' || haystack(entry).includes(query))
    .slice()
    .sort((a, b) => `${a.category}\u0000${a.title}`.localeCompare(`${b.category}\u0000${b.title}`));
}

function haystack(entry: LibraryEntry): string {
  return [entry.title, entry.category, entry.subcategory, ...entry.tags].join(' ').toLowerCase();
}
