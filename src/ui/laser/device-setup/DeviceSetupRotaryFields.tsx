// Draft-bound rotary attachment fields for the Machine Setup Options step.
// Edits stay in the wizard draft; nothing reaches the live profile until the
// final atomic Save. Roller scaling follows Rotary Setup (ADR-373).

import { useState } from 'react';
import type { RotarySetup, RotaryType } from '../../../core/devices';
import { NumberField } from '../../common/NumberField';
import {
  editRollerDiameter,
  editRollerScaling,
  editRotaryFields,
  editRotaryType,
  startRotaryEdit,
  type RotaryEdit,
} from '../rotary-setup-edit';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';

export function DeviceSetupRotaryFields(props: {
  readonly value: RotarySetup;
  readonly onChange: (value: RotarySetup) => void;
}): JSX.Element {
  const { value, onChange } = props;
  // Remembers the roller diameter while scaling is off or Chuck is chosen.
  const [parkedRoller, setParkedRoller] = useState(() => startRotaryEdit(value).parkedRoller);
  const edit: RotaryEdit = { setup: value, parkedRoller };
  const apply = (next: RotaryEdit): void => {
    setParkedRoller(next.parkedRoller);
    onChange(next.setup);
  };
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
      <RotaryNumber
        label="Object diameter"
        value={value.objectDiameterMm}
        onCommit={(next) => apply(editRotaryFields(edit, { objectDiameterMm: next }))}
      />
      {value.type === 'roller' ? (
        <RollerScaleRows edit={edit} scaled={scaledRoller} onEdit={apply} />
      ) : null}
      <RotaryNumber
        label="Motion per turn"
        value={value.mmPerRotation}
        disabled={value.type === 'roller' && !scaledRoller}
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
            title="Reverse rotary travel only if the calibration test moves in the wrong direction."
          />
          Reverse rotary axis
        </label>
      </Row>
      <p style={mutedStyle}>
        Run the rotary calibration pattern after saving and measure one full revolution before
        production.
      </p>
    </div>
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
            title="Leave off when the controller already moves the part's surface in millimetres."
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
      <span style={unitStyle}>mm</span>
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
