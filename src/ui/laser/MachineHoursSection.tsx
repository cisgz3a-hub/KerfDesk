// ADR-502: the machine's measured run time and its maintenance reminders, in
// the machine rail. A due reminder is a note, never a stop: jobs start as
// before.

import { useState } from 'react';
import { machineKindOf } from '../../core/scene';
import { Button, NumberInput } from '../kit';
import { deviceProfileSignature } from './device-setup/device-setup-nudge';
import { useStore } from '../state';
import {
  formatHours,
  hoursUntilDue,
  machineRecord,
  type MachineHoursRecord,
  type MaintenanceReminder,
} from '../state/machine-hours';
import { useMachineHoursStore, type HoursMachine } from '../state/machine-hours-store';
import { CollapsibleRailSection } from './CollapsibleRailSection';

export function MachineHoursSection(): JSX.Element {
  const device = useStore((state) => state.project.device);
  const kind = useStore((state) => machineKindOf(state.project.machine));
  const book = useMachineHoursStore((store) => store.book);
  const machine: HoursMachine = {
    signature: deviceProfileSignature(device, kind),
    name: device.name,
    kind,
  };
  const record = machineRecord(book, machine.signature, machine.name, kind);
  const due = record.reminders.filter((reminder) => hoursUntilDue(record, reminder) <= 0).length;
  return (
    <CollapsibleRailSection
      label={due > 0 ? `Machine hours · ${due} due` : 'Machine hours'}
      title="Measured run time of this machine's jobs, and maintenance reminders."
    >
      <p style={summaryStyle}>
        {`${formatHours(record.runMs)} over ${countText(record.jobs, 'job')} on ${device.name}.`}{' '}
        <span style={mutedStyle}>
          Measured while jobs run; pauses, frames and jogs are not counted.
        </span>
      </p>
      <ul style={listStyle} aria-label="Maintenance reminders">
        {record.reminders.map((reminder) => (
          <ReminderRow key={reminder.id} machine={machine} record={record} reminder={reminder} />
        ))}
      </ul>
      <AddReminderRow machine={machine} />
    </CollapsibleRailSection>
  );
}

function ReminderRow(props: {
  readonly machine: HoursMachine;
  readonly record: MachineHoursRecord;
  readonly reminder: MaintenanceReminder;
}): JSX.Element {
  const markDone = useMachineHoursStore((store) => store.markDone);
  const setEveryHours = useMachineHoursStore((store) => store.setEveryHours);
  const removeReminder = useMachineHoursStore((store) => store.removeReminder);
  const { reminder } = props;
  const left = hoursUntilDue(props.record, reminder);
  const status =
    left > 0 ? `due in ${formatHoursValue(left)}` : `due now, ${formatHoursValue(-left)} over`;
  return (
    <li style={rowStyle}>
      <span style={left > 0 ? labelStyle : dueLabelStyle}>
        {reminder.label}
        <span style={mutedStyle}>{` · ${status}`}</span>
      </span>
      <span style={controlsStyle}>
        <span style={mutedStyle}>every</span>
        <NumberInput
          key={reminder.everyHours}
          aria-label={`Hours between: ${reminder.label}`}
          style={hoursInputStyle}
          min={0.5}
          step={1}
          defaultValue={reminder.everyHours}
          onBlur={(event) => {
            if (event.currentTarget.value.trim() === '') {
              event.currentTarget.value = String(reminder.everyHours);
              return;
            }
            const hours = Number(event.currentTarget.value);
            if (hours !== reminder.everyHours) setEveryHours(props.machine, reminder.id, hours);
          }}
        />
        <span style={mutedStyle}>h</span>
        <Button
          aria-label={`Mark done: ${reminder.label}`}
          title="Done now: count the interval again from this machine's current hours."
          onClick={() => markDone(props.machine, reminder.id)}
        >
          Done
        </Button>
        <Button
          aria-label={`Remove reminder: ${reminder.label}`}
          onClick={() => removeReminder(props.machine, reminder.id)}
        >
          Remove
        </Button>
      </span>
    </li>
  );
}

function AddReminderRow(props: { readonly machine: HoursMachine }): JSX.Element {
  const addReminder = useMachineHoursStore((store) => store.addReminder);
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState('50');
  const incomplete = label.trim() === '' || hours.trim() === '';
  const add = (): void => {
    if (incomplete) return;
    addReminder(props.machine, label, Number(hours));
    setLabel('');
  };
  return (
    <div style={controlsStyle}>
      <input
        className="lf-input"
        aria-label="New reminder"
        title="What to do, such as clean the lens or check the belts. Add sets it due after the hours beside it."
        placeholder="New reminder"
        value={label}
        style={labelInputStyle}
        onChange={(event) => setLabel(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') add();
        }}
      />
      <span style={mutedStyle}>every</span>
      <NumberInput
        aria-label="Hours between: new reminder"
        style={hoursInputStyle}
        min={0.5}
        step={1}
        value={hours}
        onChange={(event) => setHours(event.currentTarget.value)}
      />
      <span style={mutedStyle}>h</span>
      <Button onClick={add} disabled={incomplete}>
        Add
      </Button>
    </div>
  );
}

function formatHoursValue(hours: number): string {
  return formatHours(hours * 3_600_000);
}

function countText(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

const summaryStyle: React.CSSProperties = { margin: '0 0 6px' };
const mutedStyle: React.CSSProperties = { color: 'var(--lf-text-muted)' };
const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: '0 0 6px',
  padding: 0,
  display: 'grid',
  gap: 6,
};
const rowStyle: React.CSSProperties = { display: 'grid', gap: 3 };
const labelStyle: React.CSSProperties = {};
const dueLabelStyle: React.CSSProperties = { color: 'var(--lf-warning)', fontWeight: 600 };
const controlsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};
const hoursInputStyle: React.CSSProperties = { width: 56 };
const labelInputStyle: React.CSSProperties = { flex: 1, minWidth: 90 };
