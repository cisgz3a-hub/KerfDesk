// Command search (Ctrl+K, Help → Find a command…, or the menu-bar search
// button). One box over every command the menus offer: type a few letters,
// pick with the arrow keys, run with Enter. It renders the registry's own
// commands, so a result runs exactly what the menu item runs, and a disabled
// result shows the same reason the menu's hover help gives.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MachineKind } from '../../core/scene';
import { COMMAND_HELP } from '../help/command-help-topics';
import { commandHelpId } from '../help/help-topics';
import { Dialog } from '../kit';
import { commandFamilyLabel } from './command-family-label';
import { runCommand, type AppCommand } from './command-registry';
import { searchCommands } from './command-search';
import { useCommandSearchStore } from './command-search-store';
import './command-search.css';

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
      onClose={close}
    />
  );
}

export function CommandSearchDialog(props: {
  readonly commands: ReadonlyArray<AppCommand>;
  readonly machineKind: MachineKind;
  readonly onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const { commands, machineKind } = props;
  const results = useMemo(
    () =>
      searchCommands(commands, query, (command) => commandFamilyLabel(command.family, machineKind)),
    [commands, query, machineKind],
  );
  const active = results[Math.min(activeIndex, results.length - 1)]?.command;

  const run = (command: AppCommand): void => {
    if (!command.enabled) return;
    props.onClose();
    runCommand(command);
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
        placeholder="Type what you want to do, such as box, offset or frame"
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
        commands={results.map((result) => result.command)}
        active={active}
        machineKind={machineKind}
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
  readonly commands: ReadonlyArray<AppCommand>;
  readonly active: AppCommand | undefined;
  readonly machineKind: MachineKind;
  readonly onHover: (index: number) => void;
  readonly onRun: (command: AppCommand) => void;
}): JSX.Element {
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [props.active]);
  if (props.commands.length === 0) {
    return (
      <p className="lf-command-search__empty" role="status">
        No command matches “{props.query.trim()}”. Try another word, or browse Help → Visual
        tutorials.
      </p>
    );
  }
  return (
    <ul ref={listRef} id={props.listId} role="listbox" className="lf-command-search__list">
      {props.commands.map((command, index) => (
        <CommandSearchRow
          key={command.id}
          id={optionId(props.listId, command)}
          command={command}
          family={commandFamilyLabel(command.family, props.machineKind)}
          selected={command === props.active}
          onHover={() => props.onHover(index)}
          onRun={() => props.onRun(command)}
        />
      ))}
    </ul>
  );
}

function CommandSearchRow(props: {
  readonly id: string;
  readonly command: AppCommand;
  readonly family: string;
  readonly selected: boolean;
  readonly onHover: () => void;
  readonly onRun: () => void;
}): JSX.Element {
  const { command } = props;
  const detail = command.disabledReason ?? COMMAND_HELP[command.id]?.tooltip ?? command.title;
  return (
    <li
      id={props.id}
      role="option"
      aria-selected={props.selected}
      aria-disabled={!command.enabled}
      className="lf-command-search__option"
      data-command-id={command.id}
      // Keep focus in the search box; the click itself runs the command.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={props.selected ? undefined : props.onHover}
      onClick={props.onRun}
    >
      <span className="lf-command-search__row">
        <span className="lf-command-search__label">{command.label}</span>
        <span className="lf-command-search__family">{props.family}</span>
        {command.shortcut === undefined ? null : (
          <kbd className="lf-command-search__shortcut">{command.shortcut}</kbd>
        )}
      </span>
      <span className="lf-command-search__detail">{detail}</span>
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

function optionId(listId: string, command: AppCommand): string {
  return `${listId}-${command.id.replace(/[^a-z0-9-]/gi, '-')}`;
}
