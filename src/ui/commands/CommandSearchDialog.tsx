// Command search (Ctrl+K, Help → Find a command…, or the menu-bar search
// button). One box over every command the menus offer, and since ADR-604
// Amendment 1 the machine-panel actions, Settings and Learn lessons too
// (search-entries.ts): type a few letters, pick with the arrow keys, run with
// Enter. A menu result runs exactly what the menu item runs, and a disabled
// result shows the same reason the menu's hover help gives.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MachineKind } from '../../core/scene';
import { commandHelpId } from '../help/help-topics';
import { Dialog } from '../kit';
import { commandFamilyLabel } from './command-family-label';
import { runCommand, type AppCommand } from './command-registry';
import { commandSearchEntry, searchEntries, type SearchEntry } from './command-search';
import { searchExtraEntries } from './search-entries';
import { useCommandSearchStore } from './command-search-store';
import './command-search.css';
import { shortcutLabel } from '../common/shortcut-label';

export function CommandSearchHost(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
}): JSX.Element | null {
  const open = useCommandSearchStore((state) => state.open);
  const close = useCommandSearchStore((state) => state.closeCommandSearch);
  if (!open) return null;
  return (
    <CommandSearchDialog
      commands={props.commands}
      machineKind={props.machineKind}
      extraEntries={searchExtraEntries}
      onClose={close}
    />
  );
}

export function CommandSearchDialog(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
  /** The panel actions, Settings and lessons the app adds (ADR-604 Amendment 1). */
  readonly extraEntries?: (machineKind: MachineKind, query: string) => SearchEntry[];
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const { commands, machineKind, extraEntries } = props;
  const results = useMemo(() => {
    const menu = commands.map((command) =>
      commandSearchEntry(command, commandFamilyLabel(command.family, machineKind)),
    );
    return searchEntries([...menu, ...(extraEntries?.(machineKind, query) ?? [])], query);
  }, [commands, query, machineKind, extraEntries]);
  const active = results[Math.min(activeIndex, results.length - 1)]?.entry;

  const run = (entry: SearchEntry): void => {
    if (!entry.enabled) return;
    props.onClose();
    if (entry.command === undefined) entry.invoke();
    else runCommand(entry.command);
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    const step = SELECTION_STEPS[event.key];
    if (step !== undefined) {
      event.preventDefault();
      setActiveIndex((index) => nextIndex(index, step, results.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (active !== undefined) run(active);
    }
  };

  return (
    <Dialog
      onClose={props.onClose}
      ariaLabel="Find a command"
      size="md"
      panelClassName="lf-command-search"
    >
      <input
        className="lf-input lf-command-search__input"
        type="text"
        role="combobox"
        aria-label="Find a command"
        data-help-id={commandHelpId('help.find-command')}
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        {...(active === undefined ? {} : { 'aria-activedescendant': optionId(listId, active) })}
        placeholder="Type what you want to do, such as frame, box or units"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      <CommandSearchResults
        listId={listId}
        query={query}
        entries={results.map((result) => result.entry)}
        active={active}
        onHover={setActiveIndex}
        onRun={run}
      />
      <p className="lf-command-search__hint" aria-hidden="true">
        ↑ ↓ to choose · Enter to run · Esc to close
      </p>
    </Dialog>
  );
}

function CommandSearchResults(props: {
  readonly listId: string;
  readonly query: string;
  readonly entries: ReadonlyArray<SearchEntry>;
  readonly active: SearchEntry | undefined;
  readonly onHover: (index: number) => void;
  readonly onRun: (entry: SearchEntry) => void;
}): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [props.active]);
  if (props.entries.length === 0) {
    return (
      <p className="lf-command-search__empty" role="status">
        Nothing matches “{props.query.trim()}”. Try another word, or browse Help → Visual tutorials.
      </p>
    );
  }
  return (
    <ul ref={listRef} id={props.listId} role="listbox" className="lf-command-search__list">
      {props.entries.map((entry, index) => (
        <CommandSearchRow
          key={entry.id}
          id={optionId(props.listId, entry)}
          entry={entry}
          selected={entry === props.active}
          onHover={() => props.onHover(index)}
          onRun={() => props.onRun(entry)}
        />
      ))}
    </ul>
  );
}

function CommandSearchRow(props: {
  readonly id: string;
  readonly entry: SearchEntry;
  readonly selected: boolean;
  readonly onHover: () => void;
  readonly onRun: () => void;
}): JSX.Element {
  const { entry } = props;
  return (
    <li
      id={props.id}
      role="option"
      aria-selected={props.selected}
      aria-disabled={!entry.enabled}
      className="lf-command-search__option"
      data-command-id={entry.id}
      data-entry-kind={entry.kind}
      // Keep focus in the search box; the click itself runs the command.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={props.selected ? undefined : props.onHover}
      onClick={props.onRun}
    >
      <span className="lf-command-search__row">
        <span className="lf-command-search__label">{entry.label}</span>
        <span className="lf-command-search__family">{entry.family}</span>
        {entry.shortcut === undefined ? null : (
          <kbd className="lf-command-search__shortcut">{shortcutLabel(entry.shortcut)}</kbd>
        )}
      </span>
      <span className="lf-command-search__detail">{entry.detail}</span>
    </li>
  );
}

const SELECTION_STEPS: Readonly<Record<string, number>> = {
  ArrowDown: 1,
  ArrowUp: -1,
  PageDown: 8,
  PageUp: -8,
};

function nextIndex(index: number, step: number, count: number): number {
  if (count === 0) return 0;
  const current = Math.min(index, count - 1);
  // Single steps wrap around the ends; page steps stop at them.
  if (Math.abs(step) === 1) return (current + step + count) % count;
  return Math.max(0, Math.min(count - 1, current + step));
}

function optionId(listId: string, entry: SearchEntry): string {
  return `${listId}-${entry.id.replace(/[^a-z0-9-]/gi, '-')}`;
}
