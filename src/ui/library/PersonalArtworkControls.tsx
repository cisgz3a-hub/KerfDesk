import { useState } from 'react';
import { useStore } from '../state/store';
import type { usePersonalArtwork } from './use-personal-artwork';

type PersonalArtworkBrowser = ReturnType<typeof usePersonalArtwork>;

export function PersonalArtworkSave(props: {
  readonly library: PersonalArtworkBrowser;
  readonly categories: readonly string[];
}): JSX.Element {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const hasSelection = useStore(
    (state) => state.selectedObjectId !== null || state.additionalSelectedIds.size > 0,
  );
  return (
    <fieldset disabled={props.library.busy || !props.library.loaded}>
      <legend>Save selection</legend>
      <label>
        Name
        <input value={name} onInput={(event) => setName(event.currentTarget.value)} />
      </label>
      <label>
        Category
        <input
          value={category}
          onInput={(event) => setCategory(event.currentTarget.value)}
          list="personal-artwork-categories"
        />
      </label>
      <datalist id="personal-artwork-categories">
        {props.categories.map((value) => (
          <option key={value} value={value} />
        ))}
      </datalist>
      <button
        type="button"
        disabled={!hasSelection || name.trim() === ''}
        onClick={() => props.library.save(name, category)}
      >
        Save selection to My artwork
      </button>
      {!hasSelection ? <span>Select artwork on the canvas first.</span> : null}
    </fieldset>
  );
}

export function PersonalArtworkFilters(props: {
  readonly library: PersonalArtworkBrowser;
  readonly categories: readonly string[];
  readonly search: string;
  readonly setSearch: (value: string) => void;
  readonly category: string;
  readonly setCategory: (value: string) => void;
}): JSX.Element {
  return (
    <div className="lf-personal-artwork__controls">
      <label>
        Search my artwork
        <input
          type="search"
          value={props.search}
          onInput={(event) => props.setSearch(event.currentTarget.value)}
        />
      </label>
      <label>
        Show category
        <select
          value={props.category}
          onChange={(event) => props.setCategory(event.currentTarget.value)}
        >
          <option value="">All categories</option>
          {props.categories.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={props.library.busy || !props.library.loaded}
        onClick={props.library.importLibrary}
      >
        Import library...
      </button>
      <button
        type="button"
        disabled={props.library.busy || !props.library.loaded || props.library.entries.length === 0}
        onClick={props.library.exportLibrary}
      >
        Export library...
      </button>
    </div>
  );
}
