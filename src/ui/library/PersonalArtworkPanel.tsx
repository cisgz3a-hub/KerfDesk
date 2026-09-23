import { useState } from 'react';
import { filterPersonalArtwork, type PersonalArtwork } from './personal-artwork-model';
import type { PersonalArtworkRepository } from './personal-artwork-storage';
import { usePersonalArtwork } from './use-personal-artwork';
import { PersonalArtworkSave, PersonalArtworkFilters } from './PersonalArtworkControls';
import './personal-artwork.css';

export type PersonalArtworkBrowser = ReturnType<typeof usePersonalArtwork>;

export function PersonalArtworkPanel(props: {
  readonly onClose: () => void;
  readonly repository?: PersonalArtworkRepository;
}): JSX.Element {
  const library = usePersonalArtwork(props.onClose, props.repository);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const entries = filterPersonalArtwork(library.entries, search, category);
  const categories = [
    ...new Set(library.entries.map((entry) => entry.category).filter(Boolean)),
  ].sort();
  return (
    <section className="lf-personal-artwork" aria-label="My artwork">
      <p>
        Save selected logos and jigs here for reuse. Text, images, groups and operation settings
        stay editable. Stored locally on this device.
      </p>
      <PersonalArtworkSave library={library} categories={categories} />
      <PersonalArtworkFilters
        library={library}
        categories={categories}
        search={search}
        setSearch={setSearch}
        category={category}
        setCategory={setCategory}
      />
      {library.error !== '' ? (
        <p role="alert">
          {library.error}{' '}
          <button
            type="button"
            title="Try loading My artwork again."
            disabled={library.busy}
            onClick={library.retry}
          >
            Retry
          </button>
        </p>
      ) : null}
      {library.busy ? <p role="status">Updating My artwork...</p> : null}
      {!library.loaded && library.error === '' ? <p role="status">Loading My artwork...</p> : null}
      {library.loaded && entries.length === 0 ? <p>No saved artwork matches this view.</p> : null}
      <PersonalArtworkResults library={library} entries={entries} />
    </section>
  );
}

function PersonalArtworkResults(props: {
  readonly library: PersonalArtworkBrowser;
  readonly entries: readonly PersonalArtwork[];
}): JSX.Element {
  const [selectedId, setSelectedId] = useState('');
  const selected = props.entries.find((entry) => entry.id === selectedId) ?? props.entries[0];
  return (
    <>
      <div className="lf-personal-artwork__items" aria-label="Saved artwork">
        {props.entries.map((entry) => (
          <button
            type="button"
            key={entry.id}
            aria-pressed={entry.id === selected?.id}
            title="Choose this saved artwork to view its available actions."
            onClick={() => setSelectedId(entry.id)}
          >
            <strong>{entry.name}</strong>
            <span>{entry.category || 'Uncategorised'}</span>
          </button>
        ))}
      </div>
      {selected === undefined ? null : (
        <div className="lf-personal-artwork__selection">
          <p>
            <strong>{selected.name}</strong> will be added at its saved position with separate
            copies of its operations. Check their settings for this machine.
          </p>
          <button
            type="button"
            disabled={props.library.busy}
            title="Add an editable copy of this artwork and its operations to the current project."
            onClick={() => props.library.insert(selected)}
          >
            Insert artwork
          </button>
          <button
            type="button"
            disabled={props.library.busy}
            title="Remove this saved entry from My artwork."
            onClick={() => props.library.remove(selected.id)}
          >
            Delete from My artwork
          </button>
        </div>
      )}
    </>
  );
}
