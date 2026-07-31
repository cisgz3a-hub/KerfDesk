import { LIBRARY_CATEGORIES } from './design-library';
import type { LibraryFilters } from './design-library-filter';
import type {
  LibraryEntry,
  LibraryEntryKind,
  LibraryMachineMode,
  LibraryOperation,
  LibrarySourceKind,
} from './design-library-types';
import { activeLibraryFilterCount } from './design-library-view-model';

export type UpdateLibraryFilter = <K extends keyof LibraryFilters>(
  key: K,
  value: LibraryFilters[K],
) => void;

const OPERATION_LABELS: Readonly<Record<LibraryOperation, string>> = {
  line: 'Line',
  fill: 'Fill',
  image: 'Image',
  profile: 'Profile',
  pocket: 'Pocket',
  drill: 'Drill',
  'v-carve': 'V-carve',
  calibration: 'Calibration',
};

const SOURCE_LABELS: Readonly<Record<LibrarySourceKind, string>> = {
  owned: 'CurveDesk originals',
  tabler: 'Tabler Icons',
  lucide: 'Lucide',
  cc0: 'CC0 / public domain',
  'public-domain': 'Public domain',
};

export function CollectionRail(props: {
  readonly entries: ReadonlyArray<LibraryEntry>;
  readonly filters: LibraryFilters;
  readonly updateFilter: UpdateLibraryFilter;
}): JSX.Element {
  const categories = LIBRARY_CATEGORIES.map((category) => ({
    category,
    count: props.entries.filter((entry) => entry.category === category).length,
  })).filter(({ count }) => count > 0);
  const selected = props.filters.category ?? 'all';
  return (
    <nav className="lf-library-collections" aria-label="Library collections">
      <div className="lf-library-collections__heading">Collections</div>
      <div className="lf-library-collections__list">
        <CollectionButton
          label="All designs"
          count={props.entries.length}
          pressed={selected === 'all'}
          onClick={() => props.updateFilter('category', 'all')}
        />
        {categories.map(({ category, count }) => (
          <CollectionButton
            key={category}
            label={category}
            count={count}
            pressed={selected === category}
            onClick={() => props.updateFilter('category', category)}
          />
        ))}
      </div>
    </nav>
  );
}

function CollectionButton(props: {
  readonly label: string;
  readonly count: number;
  readonly pressed: boolean;
  readonly onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-library-collection"
      aria-pressed={props.pressed}
      onClick={props.onClick}
      title={`Show ${props.label.toLowerCase()}.`}
    >
      <span>{props.label}</span>
      <span className="lf-library-collection__count">{props.count}</span>
    </button>
  );
}

export function LibraryToolbar(props: {
  readonly entries: ReadonlyArray<LibraryEntry>;
  readonly filters: LibraryFilters;
  readonly filtersOpen: boolean;
  readonly updateFilter: UpdateLibraryFilter;
  readonly setFiltersOpen: (open: boolean) => void;
  readonly clearFilters: () => void;
}): JSX.Element {
  const activeCount = activeLibraryFilterCount(props.filters);
  const hasQuery = (props.filters.search ?? '') !== '';
  return (
    <div className="lf-library-toolbar">
      <label className="lf-library-search">
        <span>Search library</span>
        <input
          aria-label="Search design library"
          title="Search designs by title, creator, source, or license."
          type="search"
          value={props.filters.search ?? ''}
          onInput={(event) => props.updateFilter('search', event.currentTarget.value)}
          placeholder="Designs, creators, sources, or licenses"
        />
      </label>
      <div className="lf-library-toolbar__actions">
        {hasQuery ? (
          <button
            type="button"
            className="lf-library-text-button"
            title="Clear the Library search."
            onClick={() => props.updateFilter('search', '')}
          >
            Clear search
          </button>
        ) : null}
        <button
          type="button"
          className="lf-library-filter-toggle"
          aria-label={activeCount === 0 ? 'Filters' : `Filters, ${activeCount} active`}
          aria-expanded={props.filtersOpen}
          aria-controls="library-filter-panel"
          title={props.filtersOpen ? 'Hide Library filters.' : 'Show Library filters.'}
          onClick={() => props.setFiltersOpen(!props.filtersOpen)}
        >
          Filters
          {activeCount > 0 ? (
            <span className="lf-library-filter-toggle__count">{activeCount}</span>
          ) : null}
        </button>
      </div>
      <FilterPanel {...props} />
    </div>
  );
}

function FilterPanel(props: {
  readonly entries: ReadonlyArray<LibraryEntry>;
  readonly filters: LibraryFilters;
  readonly filtersOpen: boolean;
  readonly updateFilter: UpdateLibraryFilter;
  readonly clearFilters: () => void;
}): JSX.Element | null {
  if (!props.filtersOpen) return null;
  const operations = uniqueValues(props.entries.flatMap((entry) => entry.operations));
  const sources = uniqueValues(props.entries.map((entry) => entry.provenance.sourceKind));
  return (
    <div className="lf-library-filter-panel" id="library-filter-panel">
      <FilterSelect
        label="Machine"
        ariaLabel="Machine filter"
        value={props.filters.machine ?? 'all'}
        onChange={(value) => props.updateFilter('machine', value as LibraryMachineMode | 'all')}
        options={[
          ['all', 'All machines'],
          ['laser', 'Laser'],
          ['cnc', 'CNC'],
        ]}
      />
      <FilterSelect
        label="Design type"
        ariaLabel="Type filter"
        value={props.filters.kind ?? 'all'}
        onChange={(value) => props.updateFilter('kind', value as LibraryEntryKind | 'all')}
        options={[
          ['all', 'All types'],
          ['owned-template', 'Templates'],
          ['bundled-artwork', 'Artwork'],
        ]}
      />
      <FilterSelect
        label="Suggested use"
        ariaLabel="Suggested use filter"
        value={props.filters.operation ?? 'all'}
        onChange={(value) => props.updateFilter('operation', value as LibraryOperation | 'all')}
        options={[
          ['all', 'All suggested uses'],
          ...operations.map((operation) => [operation, OPERATION_LABELS[operation]] as const),
        ]}
      />
      <FilterSelect
        label="Source"
        ariaLabel="Source filter"
        value={props.filters.sourceKind ?? 'all'}
        onChange={(value) => props.updateFilter('sourceKind', value as LibrarySourceKind | 'all')}
        options={[
          ['all', 'All sources'],
          ...sources.map((source) => [source, SOURCE_LABELS[source]] as const),
        ]}
      />
      <button
        type="button"
        className="lf-library-text-button"
        title="Reset all Library filters."
        onClick={props.clearFilters}
      >
        Clear all filters
      </button>
    </div>
  );
}

function FilterSelect(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly options: ReadonlyArray<readonly [string, string]>;
}): JSX.Element {
  return (
    <label className="lf-library-filter-field">
      <span>{props.label}</span>
      <select
        aria-label={props.ariaLabel}
        title={`Filter designs by ${props.label.toLowerCase()}.`}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function uniqueValues<T extends string>(values: ReadonlyArray<T>): T[] {
  return [...new Set(values)];
}
