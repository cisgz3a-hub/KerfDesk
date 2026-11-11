// Draft-bound rotary attachment fields for the Machine Setup Options step.
// Edits stay in the wizard draft; nothing reaches the live profile until the
// final atomic Save. Roller scaling follows Rotary Setup (ADR-373).

import { useState } from 'react';
import type { RotarySetup, RotaryType } from '../../../core/devices';
import { activeRotaryTaper, type RotaryAxis } from '../../../core/devices/rotary';
import { rotaryAxisOf, rotaryAxisUnitLabel } from '../../../core/devices/rotary-axis';
import { NumberField } from '../../common/NumberField';
import {
  editRollerDiameter,
  editRollerScaling,
  editRotaryAxis,
  editRotaryFields,
  editRotaryType,
  startRotaryEdit,
  type RotaryEdit,
} from '../rotary-setup-edit';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';

export function DeviceSetupRotaryFields(props: {
  readonly value: RotarySetup;
  /** The axes the draft's controller can turn a rotary on (ADR-695). */
  readonly axes?: ReadonlyArray<RotaryAxis>;
  readonly onChange: (value: RotarySetup) => void;
}): JSX.Element {
  const { value, onChange } = props;
  const axis = rotaryAxisOf(value);
  const { edit, apply } = useDraftRotaryEdit(value, onChange);
  const scaledRoller = value.type === 'roller' && value.rollerDiameterMm !== undefined;
  return (
    <div style={bodyStyle}>
      <Row label="Rotary">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => apply(editRotaryFields(edit, { enabled: event.target.checked }))}
            aria-label="Enable rotary attachment"
            title="Enable rotary output only while the attachment is installed and calibrated."
          />
          Enable only while the attachment is installed
        </label>
      </Row>
      <Row label="Type">
        <select
          value={value.type}
          onChange={(event) => apply(editRotaryType(edit, event.target.value as RotaryType))}
          aria-label="Rotary type"
          title="Choose whether the rotary attachment uses rollers or a chuck."
        >
          <option value="roller">Roller</option>
          <option value="chuck">Chuck</option>
        </select>
      </Row>
      <RotaryAxisRow
        axis={axis}
        axes={props.axes ?? ['Y']}
        onChange={(next) => apply(editRotaryAxis(edit, next))}
      />
      <RotaryNumber
        label="Object diameter"
        value={value.objectDiameterMm}
        // ADR-694: a tapered part's wider end sets it, in Rotary Setup.
        disabled={activeRotaryTaper(value) !== null}
        onCommit={(next) => apply(editRotaryFields(edit, { objectDiameterMm: next }))}
      />
      {value.type === 'roller' ? (
        <RollerScaleRows edit={edit} scaled={scaledRoller} onEdit={apply} />
      ) : null}
      <RotaryNumber
        label="Motion per turn"
        value={value.mmPerRotation}
        disabled={value.type === 'roller' && !scaledRoller}
        unit={rotaryAxisUnitLabel(axis) === '°' ? '°' : 'mm'}
        onCommit={(next) => apply(editRotaryFields(edit, { mmPerRotation: next }))}
      />
      <Row label="Direction">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.reverseAxis === true}
            onChange={(event) =>
              apply(editRotaryFields(edit, { reverseAxis: event.target.checked }))
            }
            aria-label="Reverse rotary direction"
            title="Reverse rotary travel only if burned text comes out mirrored around the part."
          />
          Reverse rotary axis
        </label>
      </Row>
      <p style={mutedStyle}>
        After saving, use Test rotation in Rotary Setup to check one revolution. Then burn the
        rotary test pattern and measure its height around the part: it should match the height
        Generate test pattern reports.
      </p>
    </div>
  );
}

// Remembers the roller diameter while scaling is off or Chuck is chosen, and
// Motion per turn in the units the axis is not using (ADR-695).
function useDraftRotaryEdit(
  value: RotarySetup,
  onChange: (value: RotarySetup) => void,
): { readonly edit: RotaryEdit; readonly apply: (next: RotaryEdit) => void } {
  const [parked, setParked] = useState<Omit<RotaryEdit, 'setup'>>(() => {
    const { setup: _setup, ...rest } = startRotaryEdit(value);
    return rest;
  });
  return {
    edit: { ...parked, setup: value },
    apply: (next) => {
      const { setup, ...rest } = next;
      setParked(rest);
      onChange(setup);
    },
  };
}

// ADR-695: Y when the rotary takes the Y motor's place, A or Z for its own
// connector. A saved axis this controller cannot take stays listed.
function RotaryAxisRow(props: {
  readonly axis: RotaryAxis;
  readonly axes: ReadonlyArray<RotaryAxis>;
  readonly onChange: (axis: RotaryAxis) => void;
}): JSX.Element {
  const shown = props.axes.includes(props.axis) ? props.axes : [...props.axes, props.axis];
  return (
    <Row label="Rotary axis">
      <select
        value={props.axis}
        onChange={(event) => props.onChange(event.target.value as RotaryAxis)}
        aria-label="Rotary axis"
        title="Y when the rotary is plugged in where the Y motor was; A or Z for a dedicated rotary connector."
      >
        {shown.map((option) => (
          <option key={option} value={option}>
            {option === 'Y' ? 'Y (Y motor port)' : `${option} (rotary connector)`}
          </option>
        ))}
      </select>
    </Row>
  );
}

function RollerScaleRows(props: {
  readonly edit: RotaryEdit;
  readonly scaled: boolean;
  readonly onEdit: (next: RotaryEdit) => void;
}): JSX.Element {
  const diameter = props.edit.setup.rollerDiameterMm;
  return (
    <>
      <Row label="Roller scale">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={props.scaled}
            onChange={(event) => props.onEdit(editRollerScaling(props.edit, event.target.checked))}
            aria-label="Scale Y from the roller diameter"
            title="Needed for a roller on an unchanged Y port. Turn off only when the controller's Y steps/mm already move the part's surface in millimetres."
          />
          Scale Y from the roller diameter
        </label>
      </Row>
      {diameter === undefined ? null : (
        <RotaryNumber
          label="Roller diameter"
          value={diameter}
          onCommit={(next) => props.onEdit(editRollerDiameter(props.edit, next))}
        />
      )}
    </>
  );
}

function RotaryNumber(props: {
  readonly label: string;
  readonly value: number;
  readonly disabled?: boolean;
  readonly unit?: string;
  readonly onCommit: (value: number) => void;
}): JSX.Element {
  return (
    <Row label={props.label}>
      <NumberField
        ariaLabel={props.label}
        value={props.value}
        min={0.1}
        max={100000}
        step={0.1}
        disabled={props.disabled === true}
        onCommit={props.onCommit}
        style={numInputStyle}
      />
      <span style={unitStyle}>{props.unit ?? 'mm'}</span>
    </Row>
  );
}

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginTop: 8,
};
const mutedStyle: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.45,
};
const inlineStyle: React.CSSProperties = {
  display: 'inline-flex',
  gap: 5,
  alignItems: 'center',
  fontSize: 12,
};
