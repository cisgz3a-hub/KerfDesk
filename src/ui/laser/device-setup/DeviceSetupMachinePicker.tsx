// Which machine do you have? (ADR-637). One searchable list of every listed
// laser and CNC machine, grouped by brand, then "My machine isn't listed".
// The whole row is the control (ADR-347): one radio group, so choosing a
// machine never depends on hitting a small button. Choosing one only changes
// the draft; Save on Review is still the only thing that changes the project.
// A choice that would replace values someone set asks first (ADR-637
// Amendment 1), so arrowing through the radios never discards them unseen.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSetupAction, DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupCustomMachine } from './DeviceSetupCustomMachine';
import { DeviceSetupMachineDetails, machineFacts } from './DeviceSetupMachineDetails';
import { machineChoiceReplaces } from './machine-choice-replaces';
import { ReplaceSettingsConfirm } from './ReplaceSettingsConfirm';
import {
  chooseCustomMachineActions,
  chooseMachineEntryActions,
  draftIsCustomMachine,
  draftLacksPresetCommandSet,
  filterMachinePickerEntries,
  groupMachinePickerEntries,
  machineEntryIsSelected,
  machinePickerEntries,
  selectedMachineEntry,
  type MachineKindFilter,
  type MachinePickerEntry,
} from './machine-picker-entries';
import './device-setup-picker.css';

const KIND_FILTERS: ReadonlyArray<{
  readonly value: MachineKindFilter;
  readonly label: string;
  readonly title: string;
}> = [
  { value: 'all', label: 'All', title: 'Show every listed machine.' },
  { value: 'laser', label: 'Laser', title: 'Show lasers, including Laser + CNC machines.' },
  { value: 'cnc', label: 'CNC', title: 'Show CNC machines, including Laser + CNC machines.' },
];

/** A machine row, or "My machine isn't listed". */
type MachineChoice = MachinePickerEntry | 'custom';

export function DeviceSetupMachinePicker({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MachineKindFilter>('all');
  const entries = useMemo(() => machinePickerEntries(state), [state]);
  const { customOpen, choose, replaceNotice } = useMachineChoice(state, dispatch, entries);
  const selected = selectedMachineEntry(state, entries);
  const custom = selected === undefined && (customOpen || draftIsCustomMachine(state, entries));
  const groups = groupMachinePickerEntries(filterMachinePickerEntries(entries, query, kind));
  const list = useScrollChosenIntoView();
  return (
    <section className="lf-setup-picker" aria-label="Choose your machine">
      <div className="lf-setup-picker-bar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search machines…"
          aria-label="Search machines"
          title="Search by brand, model, type or work area, for example “ortur”, “cnc” or “400x400”."
        />
        <div className="lf-setup-picker-kinds" role="radiogroup" aria-label="Show machines">
          {KIND_FILTERS.map((filter) => (
            <label key={filter.value} data-selected={kind === filter.value}>
              <input
                type="radio"
                name="setup-machine-kind-filter"
                checked={kind === filter.value}
                onChange={() => setKind(filter.value)}
                title={filter.title}
              />
              {filter.label}
            </label>
          ))}
        </div>
      </div>
      <div className="lf-setup-picker-list" ref={list}>
        {groups.map((group) => (
          <div key={group.brand} role="group" aria-label={group.brand}>
            <h5>{group.brand}</h5>
            {group.entries.map((entry) => (
              <MachineRow
                key={entry.id}
                entry={entry}
                state={state}
                onChoose={() => choose(entry)}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 ? (
          <p className="lf-setup-empty">
            No machine matches “{query}”. Choose My machine isn’t listed to enter its size and
            firmware.
          </p>
        ) : null}
      </div>
      {replaceNotice}
      <label className="lf-setup-picker-row lf-setup-picker-custom" data-selected={custom}>
        <input
          type="radio"
          name="setup-machine"
          checked={custom}
          onChange={() => choose('custom')}
          aria-label="My machine isn’t listed"
          title="Enter your machine's type, work area and firmware yourself."
        />
        <span className="lf-setup-picker-name">My machine isn’t listed</span>
        <span className="lf-setup-picker-meta">Enter its type, work area and firmware</span>
      </label>
      {selected !== undefined ? (
        <DeviceSetupMachineDetails state={state} dispatch={dispatch} entry={selected} />
      ) : null}
      {custom ? <DeviceSetupCustomMachine state={state} dispatch={dispatch} /> : null}
    </section>
  );
}

// A choice applies at once unless it would replace values someone set; then
// it waits for Replace settings (ADR-637 Amendment 1).
function useMachineChoice(
  state: DeviceSetupStepProps['state'],
  dispatch: DeviceSetupStepProps['dispatch'],
  entries: ReadonlyArray<MachinePickerEntry>,
): {
  readonly customOpen: boolean;
  readonly choose: (choice: MachineChoice) => void;
  readonly replaceNotice: JSX.Element | null;
} {
  const [customOpen, setCustomOpen] = useState(false);
  const [pending, setPending] = useState<MachineChoice | null>(null);
  const actionsFor = (choice: MachineChoice): ReadonlyArray<DeviceSetupAction> =>
    choice === 'custom'
      ? chooseCustomMachineActions(state, entries)
      : chooseMachineEntryActions(state, choice);
  const apply = (choice: MachineChoice): void => {
    setPending(null);
    setCustomOpen(choice === 'custom');
    actionsFor(choice).forEach(dispatch);
  };
  const choose = (choice: MachineChoice): void => {
    if (machineChoiceReplaces(state, entries, actionsFor(choice)).length > 0) setPending(choice);
    else apply(choice);
  };
  const replaceNotice =
    pending === null ? null : (
      <ReplaceConfirm
        choice={pending}
        replaces={machineChoiceReplaces(state, entries, actionsFor(pending))}
        onReplace={() => apply(pending)}
        onKeep={() => setPending(null)}
      />
    );
  return { customOpen, choose, replaceNotice };
}

// Asked in place, after the list: the next Tab from the radios reaches it, and
// arrowing on to another row moves the question to that row.
function ReplaceConfirm(props: {
  readonly choice: MachineChoice;
  readonly replaces: ReadonlyArray<string>;
  readonly onReplace: () => void;
  readonly onKeep: () => void;
}): JSX.Element {
  const name = props.choice === 'custom' ? 'My machine isn’t listed' : props.choice.name;
  return (
    <ReplaceSettingsConfirm
      subject={`Choosing ${name}`}
      replaces={props.replaces}
      onReplace={props.onReplace}
      onKeep={props.onKeep}
    />
  );
}

function MachineRow(props: {
  readonly entry: MachinePickerEntry;
  readonly state: DeviceSetupStepProps['state'];
  readonly onChoose: () => void;
}): JSX.Element {
  const { entry, state } = props;
  const checked = machineEntryIsSelected(state, entry);
  const stale =
    entry.kind === 'laser-profile' && draftLacksPresetCommandSet(state.draft, entry.suggestion);
  return (
    <label className="lf-setup-picker-row" data-selected={checked}>
      <input
        type="radio"
        name="setup-machine"
        checked={checked}
        onChange={props.onChoose}
        aria-label={`Use ${entry.name}`}
        title={checked ? 'This machine is chosen.' : `Start from ${entry.name}'s settings.`}
      />
      <span className="lf-setup-picker-name">{entry.model}</span>
      <span className="lf-setup-picker-meta">{machineFacts(entry).join(' · ')}</span>
      <FirmwareTag entry={entry} />
      {stale ? (
        <span className="lf-setup-profile-warning">
          This saved profile predates the preset’s vendor command set. Choose it to re-apply the
          preset; it replaces this draft’s values, so review them before saving.
        </span>
      ) : null}
    </label>
  );
}

// Only once a controller has named its firmware: whether each laser profile
// expects the same firmware. It is a hint, never an identification (ADR-240).
function FirmwareTag({ entry }: { readonly entry: MachinePickerEntry }): JSX.Element | null {
  if (entry.kind !== 'laser-profile') return null;
  if (entry.suggestion.confidence === 'possible') {
    return <span className="lf-setup-picker-tag">Same firmware</span>;
  }
  if (entry.suggestion.warnings.length > 0) {
    return <span className="lf-setup-picker-tag lf-setup-picker-tag--muted">Other firmware</span>;
  }
  return null;
}

// Opening setup on a chosen machine shows it in the list without moving the page.
function useScrollChosenIntoView(): React.RefObject<HTMLDivElement> {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = list.current;
    const row = element
      ?.querySelector('input[name="setup-machine"]:checked')
      ?.closest<HTMLElement>('.lf-setup-picker-row');
    // The list is positioned, so a row's offsetTop is measured inside it.
    if (element && row) element.scrollTop = Math.max(0, row.offsetTop - 8);
  }, []);
  return list;
}
