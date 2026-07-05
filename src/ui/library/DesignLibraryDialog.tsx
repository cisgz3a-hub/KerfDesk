// DesignLibraryDialog - bundled manufacturing templates and vetted artwork.
// Entries import through the same SVG pipeline as Import SVG so inserted
// designs remain normal editable scene objects.

import { useMemo, useState } from 'react';
import { parseSvg } from '../../io/svg';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import { useUiStore } from '../state/ui-store';
import { DESIGN_LIBRARY, LIBRARY_CATEGORIES } from './design-library';
import { filterDesignLibrary, type LibraryFilters } from './design-library-filter';
import type {
  LibraryEntry,
  LibraryEntryKind,
  LibraryMachineMode,
  LibraryOperation,
  LibrarySourceKind,
} from './design-library-types';

const OPERATIONS: ReadonlyArray<LibraryOperation> = [
  'line',
  'fill',
  'image',
  'profile',
  'pocket',
  'drill',
  'v-carve',
  'calibration',
];

const SOURCE_KINDS: ReadonlyArray<LibrarySourceKind> = ['owned', 'lucide', 'cc0', 'public-domain'];

type UpdateFilter = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]) => void;

export function DesignLibraryDialog(): JSX.Element | null {
  const open = useUiStore((s) => s.libraryDialogOpen);
  const setOpen = useUiStore((s) => s.setLibraryDialogOpen);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const pushToast = useToastStore((s) => s.pushToast);
  const [filters, setFilters] = useState<LibraryFilters>({
    category: 'all',
    machine: 'all',
    kind: 'all',
    operation: 'all',
    sourceKind: 'all',
    search: '',
  });
  const visibleEntries = useMemo(() => filterDesignLibrary(DESIGN_LIBRARY, filters), [filters]);
  if (!open) return null;

  const updateFilter = <K extends keyof LibraryFilters>(key: K, value: LibraryFilters[K]): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const insertEntry = (item: LibraryEntry, batchOffsetIdx = 0): boolean => {
    if (item.insert.kind !== 'svg') {
      pushToast(`Could not insert ${item.title}.`, 'error');
      return false;
    }
    const result = parseSvg({
      svgText: item.insert.svgText,
      id: crypto.randomUUID(),
      source: `Library: ${item.title}`,
    });
    if (result.object === null) {
      pushToast(`Could not insert ${item.title}.`, 'error');
      return false;
    }
    importSvgObject(result.object, batchOffsetIdx);
    return true;
  };

  const insertOne = (item: LibraryEntry): void => {
    if (!insertEntry(item)) return;
    pushToast(`${item.title} added to the canvas.`, 'success');
    setOpen(false);
  };

  const insertVisible = (): void => {
    let inserted = 0;
    visibleEntries.forEach((entry, idx) => {
      if (insertEntry(entry, idx)) inserted += 1;
    });
    if (inserted === 0) {
      pushToast('No visible library entries could be imported.', 'error');
      return;
    }
    pushToast(`Imported ${inserted} visible library entries.`, 'success');
  };

  return (
    <div role="dialog" aria-label="Design library" style={backdropStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h3 style={titleStyle}>Design library</h3>
          <button type="button" onClick={() => setOpen(false)} title="Close the design library.">
            Close
          </button>
        </div>

        <div style={browserStyle}>
          <CategoryRail filters={filters} updateFilter={updateFilter} />
          <div style={contentStyle}>
            <FilterBar filters={filters} updateFilter={updateFilter} />
            <ResultBar visibleCount={visibleEntries.length} insertVisible={insertVisible} />
            <EntryGrid entries={visibleEntries} insertOne={insertOne} />
          </div>
        </div>

        <p style={footStyle}>
          Owned templates and vetted artwork import as editable vectors. External artwork includes
          source and license provenance.
        </p>
      </div>
    </div>
  );
}

function CategoryRail(props: {
  readonly filters: LibraryFilters;
  readonly updateFilter: UpdateFilter;
}): JSX.Element {
  return (
    <div style={categoryRailStyle}>
      <button
        type="button"
        title="Show every library category."
        onClick={() => props.updateFilter('category', 'all')}
        aria-pressed={props.filters.category === 'all'}
        style={props.filters.category === 'all' ? activeCategoryStyle : categoryButtonStyle}
      >
        All
      </button>
      {LIBRARY_CATEGORIES.map((category) => (
        <button
          key={category}
          type="button"
          title={`Show ${category} library entries.`}
          onClick={() => props.updateFilter('category', category)}
          aria-pressed={props.filters.category === category}
          style={props.filters.category === category ? activeCategoryStyle : categoryButtonStyle}
        >
          {category}
        </button>
      ))}
    </div>
  );
}

function FilterBar(props: {
  readonly filters: LibraryFilters;
  readonly updateFilter: UpdateFilter;
}): JSX.Element {
  return (
    <div style={filterBarStyle}>
      <input
        aria-label="Search design library"
        type="search"
        title="Search the design library by name, category, tag, or source."
        value={props.filters.search ?? ''}
        onInput={(event) => props.updateFilter('search', event.currentTarget.value)}
        placeholder="Search"
        style={searchStyle}
      />
      <select
        aria-label="Machine filter"
        title="Filter designs by machine type."
        value={props.filters.machine ?? 'all'}
        onChange={(event) =>
          props.updateFilter('machine', event.currentTarget.value as LibraryMachineMode | 'all')
        }
      >
        <option value="all">All machines</option>
        <option value="laser">Laser</option>
        <option value="cnc">CNC</option>
      </select>
      <select
        aria-label="Type filter"
        title="Filter designs by template or artwork type."
        value={props.filters.kind ?? 'all'}
        onChange={(event) =>
          props.updateFilter('kind', event.currentTarget.value as LibraryEntryKind | 'all')
        }
      >
        <option value="all">All types</option>
        <option value="owned-template">Templates</option>
        <option value="bundled-artwork">Artwork</option>
      </select>
      <OperationSelect filters={props.filters} updateFilter={props.updateFilter} />
      <SourceSelect filters={props.filters} updateFilter={props.updateFilter} />
    </div>
  );
}

function OperationSelect(props: {
  readonly filters: LibraryFilters;
  readonly updateFilter: UpdateFilter;
}): JSX.Element {
  return (
    <select
      aria-label="Operation filter"
      title="Filter designs by machining or laser operation."
      value={props.filters.operation ?? 'all'}
      onChange={(event) =>
        props.updateFilter('operation', event.currentTarget.value as LibraryOperation | 'all')
      }
    >
      <option value="all">All operations</option>
      {OPERATIONS.map((operation) => (
        <option key={operation} value={operation}>
          {operation}
        </option>
      ))}
    </select>
  );
}

function SourceSelect(props: {
  readonly filters: LibraryFilters;
  readonly updateFilter: UpdateFilter;
}): JSX.Element {
  return (
    <select
      aria-label="Source filter"
      title="Filter designs by provenance source."
      value={props.filters.sourceKind ?? 'all'}
      onChange={(event) =>
        props.updateFilter('sourceKind', event.currentTarget.value as LibrarySourceKind | 'all')
      }
    >
      <option value="all">All sources</option>
      {SOURCE_KINDS.map((sourceKind) => (
        <option key={sourceKind} value={sourceKind}>
          {sourceKind}
        </option>
      ))}
    </select>
  );
}

function ResultBar(props: {
  readonly visibleCount: number;
  readonly insertVisible: () => void;
}): JSX.Element {
  return (
    <div style={resultBarStyle}>
      <span>{props.visibleCount} entries</span>
      <button
        type="button"
        aria-label="Import visible library entries"
        title="Import every library entry currently shown by the filters."
        onClick={props.insertVisible}
        disabled={props.visibleCount === 0}
      >
        Import visible
      </button>
    </div>
  );
}

function EntryGrid(props: {
  readonly entries: ReadonlyArray<LibraryEntry>;
  readonly insertOne: (item: LibraryEntry) => void;
}): JSX.Element {
  return (
    <div style={gridStyle}>
      {props.entries.map((item) => (
        <button
          key={item.id}
          type="button"
          data-library-card
          onClick={() => props.insertOne(item)}
          aria-label={`Insert ${item.title}`}
          title={`Insert "${item.title}" onto the canvas.`}
          style={cellStyle}
        >
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(item.previewSvgText)}`}
            alt={item.title}
            width={42}
            height={42}
            style={iconStyle}
          />
          <span style={nameStyle}>{item.title}</span>
          <span style={metaStyle}>{item.subcategory}</span>
          <EntryBadges item={item} />
        </button>
      ))}
    </div>
  );
}

function EntryBadges(props: { readonly item: LibraryEntry }): JSX.Element {
  const item = props.item;
  return (
    <span style={badgeRowStyle}>
      <span style={badgeStyle}>{item.kind === 'owned-template' ? 'Template' : 'Art'}</span>
      <span style={badgeStyle}>{item.machineModes.join('+')}</span>
      <span style={badgeStyle}>{item.provenance.sourceKind}</span>
    </span>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'var(--lf-backdrop)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 40,
};
const panelStyle: React.CSSProperties = {
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-text)',
  border: '1px solid var(--lf-border)',
  borderRadius: 6,
  padding: 12,
  width: 860,
  maxWidth: 'calc(100vw - 48px)',
  maxHeight: 'calc(100vh - 96px)',
  overflowY: 'auto',
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 8,
};
const titleStyle: React.CSSProperties = { fontSize: 14, margin: 0 };
const browserStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '150px 1fr',
  gap: 10,
  minHeight: 420,
};
const categoryRailStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
};
const categoryButtonStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '5px 7px',
};
const activeCategoryStyle: React.CSSProperties = {
  ...categoryButtonStyle,
  background: 'var(--lf-accent)',
  color: 'var(--lf-bg)',
};
const contentStyle: React.CSSProperties = {
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const filterBarStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) repeat(4, minmax(104px, max-content))',
  gap: 6,
  alignItems: 'center',
};
const searchStyle: React.CSSProperties = {
  minWidth: 0,
};
const resultBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))',
  gap: 8,
};
const cellStyle: React.CSSProperties = {
  minHeight: 126,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 4,
  padding: 8,
};
const iconStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  objectFit: 'contain',
  filter: 'invert(0.8)',
};
const nameStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.15,
  textAlign: 'center',
};
const metaStyle: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1.1,
  color: 'var(--lf-text-muted)',
  textAlign: 'center',
};
const badgeRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 3,
};
const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  lineHeight: 1,
  padding: '2px 3px',
  border: '1px solid var(--lf-border)',
  borderRadius: 3,
};
const footStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--lf-text-muted)',
  margin: '10px 0 0 0',
};
