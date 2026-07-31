import type { LibraryFilters } from './design-library-filter';

export const EMPTY_LIBRARY_FILTERS: LibraryFilters = {
  category: 'all',
  machine: 'all',
  kind: 'all',
  operation: 'all',
  sourceKind: 'all',
  search: '',
};

export function activeLibraryFilterCount(filters: LibraryFilters): number {
  return (['machine', 'kind', 'operation', 'sourceKind'] as const).filter(
    (key) => filters[key] !== undefined && filters[key] !== 'all',
  ).length;
}
