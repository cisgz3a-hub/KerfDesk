// Which machine do you have? (ADR-637). One searchable list of every listed
// laser and CNC machine, grouped by brand, then "My machine isn't listed".
// The whole row is the control (ADR-347): one radio group, so choosing a
// machine never depends on hitting a small button. Choosing one only changes
// the draft; Save on Review is still the only thing that changes the project.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { DeviceSetupAction, DeviceSetupStepProps } from './device-setup-flow';
import { DeviceSetupCustomMachine } from './DeviceSetupCustomMachine';
import { DeviceSetupMachineDetails, machineFacts } from './DeviceSetupMachineDetails';
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

const KIND_FILTERS: ReadonlyArray<{ readonly value: MachineKindFilter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'laser', label: 'Laser' },
  { value: 'cnc', label: 'CNC' },
];

export function DeviceSetupMachinePicker({ state, dispatch }: DeviceSetupStepProps): JSX.Element {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MachineKindFilter>('all');
  const [customOpen, setCustomOpen] = useState(false);
  const entries = useMemo(() => machinePickerEntries(state), [state]);
  const selected = selectedMachineEntry(state, entries);
  const custom = selected === undefined && (customOpen || draftIsCustomMachine(state, entries));
  const groups = groupMachinePickerEntries(filterMachinePickerEntries(entries, query, kind));
  const run = (actions: ReadonlyArray<DeviceSetupAction>): void => actions.forEach(dispatch);
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
                onChoose={() => {
                  setCustomOpen(false);
                  run(chooseMachineEntryActions(state, entry));
                }}
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
      <label className="lf-setup-picker-row lf-setup-picker-custom" data-selected={custom}>
        <input
          type="radio"
          name="setup-machine"
          checked={custom}
          onChange={() => {
            setCustomOpen(true);
            run(chooseCustomMachineActions(state, entries));
          }}
          aria-label="My machine isn’t listed"
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
