// Row building blocks for the Rotary Setup dialog.

import { NumberField } from '../common/NumberField';
import {
  fieldControlStyle,
  fieldLabelStyle,
  fieldRowStyle,
  numberStyle,
  segmentActiveStyle,
  segmentButtonStyle,
  toggleStyle,
  unitStyle,
} from './rotary-setup-dialog.styles';

export function FieldRow(props: {
  readonly label: string;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <label style={fieldRowStyle}>
      <span style={fieldLabelStyle}>{props.label}</span>
      <span style={fieldControlStyle}>{props.children}</span>
    </label>
  );
}

// Local dialog state, so each valid keystroke commits at once (no undo
// batching to protect) and the linked fields follow while typing.
export function RotaryNumberField(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly unit: string;
  readonly disabled: boolean;
  readonly title: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <FieldRow label={props.label}>
      <NumberField
        ariaLabel={props.ariaLabel}
        title={props.title}
        value={props.value}
        positiveOnly
        step={0.1}
        debounceMs={0}
        disabled={props.disabled}
        onCommit={props.onCommit}
        style={numberStyle}
      />
      <span style={unitStyle}>{props.unit}</span>
    </FieldRow>
  );
}

export function ToggleRow(props: {
  readonly checked: boolean;
  readonly label: string;
  readonly onChange: (checked: boolean) => void;
}): JSX.Element {
  return (
    <label style={toggleStyle}>
      <input
        type="checkbox"
        className="lf-checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
        title={props.label}
      />
      <span>{props.label}</span>
    </label>
  );
}

export function SegmentButton(props: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className="lf-button"
      aria-pressed={props.active}
      title="Select the rotary attachment type."
      onClick={props.onClick}
      style={{ ...segmentButtonStyle, ...(props.active ? segmentActiveStyle : {}) }}
    >
      {props.children}
    </button>
  );
}
