// Draft-bound rotary attachment fields for the Machine Setup Options step.
// Edits stay in the wizard draft; nothing reaches the live profile until the
// final atomic Save.

import type { RotarySetup, RotaryType } from '../../../core/devices';
import { NumberField } from '../../common/NumberField';
import { Row, numInputStyle, unitStyle } from '../device-settings-shared';

export function DeviceSetupRotaryFields(props: {
  readonly value: RotarySetup;
  readonly onChange: (value: RotarySetup) => void;
}): JSX.Element {
  const { value, onChange } = props;
  const number = (field: 'objectDiameterMm' | 'mmPerRotation', next: number): void =>
    onChange({ ...value, [field]: next });
  return (
    <div style={bodyStyle}>
      <Row label="Rotary">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
            aria-label="Enable rotary attachment"
            title="Enable rotary output only while the attachment is installed and calibrated."
          />
          Enable only while the attachment is installed
        </label>
      </Row>
      <Row label="Type">
        <select
          value={value.type}
          onChange={(event) => onChange({ ...value, type: event.target.value as RotaryType })}
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
        onCommit={(next) => number('objectDiameterMm', next)}
      />
      <RotaryNumber
        label="Motion per turn"
        value={value.mmPerRotation}
        onCommit={(next) => number('mmPerRotation', next)}
      />
      <Row label="Direction">
        <label style={inlineStyle}>
          <input
            type="checkbox"
            checked={value.reverseAxis === true}
            onChange={(event) => onChange({ ...value, reverseAxis: event.target.checked })}
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

function RotaryNumber(props: {
  readonly label: string;
  readonly value: number;
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
