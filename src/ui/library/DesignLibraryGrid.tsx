import type { LibraryEntry } from './design-library-types';
import { LibraryPreview } from './LibraryPreview';

export function DesignLibraryGrid(props: {
  readonly entries: ReadonlyArray<LibraryEntry>;
  readonly selectedId: string | undefined;
  readonly addingId: string | undefined;
  readonly onSelect: (entry: LibraryEntry) => void;
  readonly onAdd: (entry: LibraryEntry) => void;
  readonly clearFilters: () => void;
}): JSX.Element {
  if (props.entries.length === 0) {
    return <EmptyLibraryState clearFilters={props.clearFilters} />;
  }
  const titleCounts = countTitles(props.entries);
  return (
    <div className="lf-library-grid" aria-label="Library designs">
      {props.entries.map((entry) => (
        <LibraryCard
          key={entry.id}
          entry={entry}
          disambiguateSource={(titleCounts.get(entry.title) ?? 0) > 1}
          selected={entry.id === props.selectedId}
          adding={entry.id === props.addingId}
          addDisabled={props.addingId !== undefined}
          onSelect={() => props.onSelect(entry)}
          onAdd={() => props.onAdd(entry)}
        />
      ))}
    </div>
  );
}

function LibraryCard(props: {
  readonly entry: LibraryEntry;
  readonly disambiguateSource: boolean;
  readonly selected: boolean;
  readonly adding: boolean;
  readonly addDisabled: boolean;
  readonly onSelect: () => void;
  readonly onAdd: () => void;
}): JSX.Element {
  const entry = props.entry;
  const sourceSuffix = props.disambiguateSource ? ` from ${entry.provenance.sourceName}` : '';
  return (
    <article
      className="lf-library-card"
      data-library-card
      data-selected={props.selected ? 'true' : 'false'}
    >
      <button
        type="button"
        id={`library-card-${entry.id}`}
        className="lf-library-card__select"
        aria-label={`View details for ${entry.title}${sourceSuffix}`}
        aria-pressed={props.selected}
        aria-controls="library-detail-panel"
        title={`Inspect ${entry.title}${sourceSuffix}.`}
        onClick={props.onSelect}
      >
        <LibraryPreview entry={entry} />
        <span className="lf-library-card__body">
          <span className="lf-library-card__title">{entry.title}</span>
          <span className="lf-library-card__collection">
            {entry.subcategory}
            {props.disambiguateSource ? ` · ${entry.provenance.sourceName}` : ''}
          </span>
          <span className="lf-library-card__badges">
            <span>{entry.kind === 'owned-template' ? 'Template' : 'Artwork'}</span>
            <span>{machineLabel(entry)}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        className="lf-library-card__add"
        aria-label={
          props.adding
            ? `Adding ${entry.title}${sourceSuffix} to canvas`
            : `Add ${entry.title}${sourceSuffix} to canvas`
        }
        title={props.adding ? `Adding ${entry.title}.` : `Add ${entry.title} to the canvas.`}
        disabled={props.addDisabled}
        onClick={props.onAdd}
      >
        {props.adding ? null : <span aria-hidden="true">+</span>}
        {props.adding ? 'Adding...' : 'Add'}
      </button>
    </article>
  );
}

function EmptyLibraryState(props: { readonly clearFilters: () => void }): JSX.Element {
  return (
    <div className="lf-library-empty">
      <span className="lf-library-empty__mark" aria-hidden="true">
        ◌
      </span>
      <h3>No designs found</h3>
      <p>Try a broader search or reset the active collection and filters.</p>
      <button
        type="button"
        className="lf-btn"
        title="Reset the Library search, collection, and filters."
        onClick={props.clearFilters}
      >
        Clear filters
      </button>
    </div>
  );
}

function machineLabel(entry: LibraryEntry): string {
  if (entry.machineModes.length === 2) return 'Laser + CNC';
  return entry.machineModes[0] === 'cnc' ? 'CNC' : 'Laser';
}

function countTitles(entries: ReadonlyArray<LibraryEntry>): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.title, (counts.get(entry.title) ?? 0) + 1);
  }
  return counts;
}
