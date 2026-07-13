import { useState } from 'react';
import {
  DEFAULT_ROTARY_SETUP,
  rotaryCircumferenceMm,
  rotaryYLimitMm,
  type RotarySetup,
  type RotaryType,
} from '../../core/devices';
import { Button, Dialog, DialogActions, NumberInput } from '../kit';

export function RotarySetupDialog(props: {
  readonly setup: RotarySetup | undefined;
  readonly onCancel: () => void;
  readonly onApply: (setup: RotarySetup) => void;
  readonly onGenerateCalibration: (setup: RotarySetup) => void;
}): JSX.Element {
  const [draft, setDraft] = useState<RotarySetup>(props.setup ?? DEFAULT_ROTARY_SETUP);
  const valid = validRotarySetup(draft);
  return (
    <Dialog title="Rotary Setup" size="sm" onClose={props.onCancel}>
      <RotarySetupFields draft={draft} onChange={setDraft} />
      <RotaryPreview draft={draft} valid={valid} />
      {!valid ? (
        <p style={errorStyle}>Diameter and motion per turn must be greater than zero.</p>
      ) : null}
      <RotaryActions draft={draft} valid={valid} {...props} />
    </Dialog>
  );
}

function RotarySetupFields(props: {
  readonly draft: RotarySetup;
  readonly onChange: (setup: RotarySetup) => void;
}): JSX.Element {
  const { draft, onChange } = props;
  const setType = (type: RotaryType): void => onChange({ ...draft, type });
  const setNumber = (field: 'objectDiameterMm' | 'mmPerRotation', value: number): void =>
    onChange({ ...draft, [field]: value });
  return (
    <>
      <ToggleRow
        checked={draft.enabled}
        label="Enable rotary for this machine profile"
        onChange={(enabled) => onChange({ ...draft, enabled })}
      />
      <FieldRow label="Rotary type">
        <div role="group" aria-label="Rotary type" style={segmentStyle}>
          <SegmentButton active={draft.type === 'roller'} onClick={() => setType('roller')}>
            Roller
          </SegmentButton>
          <SegmentButton active={draft.type === 'chuck'} onClick={() => setType('chuck')}>
            Chuck
          </SegmentButton>
        </div>
      </FieldRow>
      <RotaryNumberField
        label="Object diameter"
        ariaLabel="Rotary object diameter"
        value={draft.objectDiameterMm}
        unit="mm"
        onChange={(value) => setNumber('objectDiameterMm', value)}
      />
      <RotaryNumberField
        label="Motion per turn"
        ariaLabel="Rotary millimetres per rotation"
        value={draft.mmPerRotation}
        unit="machine mm"
        disabled={draft.type === 'roller'}
        onChange={(value) => setNumber('mmPerRotation', value)}
      />
      <ToggleRow
        checked={draft.reverseAxis === true}
        label="Reverse rotary direction"
        onChange={(reverseAxis) => onChange({ ...draft, reverseAxis })}
      />
    </>
  );
}

function RotaryNumberField(props: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly value: number;
  readonly unit: string;
  readonly disabled?: boolean;
  readonly onChange: (value: number) => void;
}): JSX.Element {
  return (
    <FieldRow label={props.label}>
      <NumberInput
        aria-label={props.ariaLabel}
        min={0.1}
        step={0.1}
        value={props.value}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.currentTarget.valueAsNumber)}
        style={numberStyle}
      />
      <span style={unitStyle}>{props.unit}</span>
    </FieldRow>
  );
}

function ToggleRow(props: {
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

function RotaryPreview(props: {
  readonly draft: RotarySetup;
  readonly valid: boolean;
}): JSX.Element {
  const circumference = props.valid ? rotaryCircumferenceMm(props.draft) : 0;
  const machineWrap = props.valid ? rotaryYLimitMm(props.draft) : 0;
  return (
    <div style={previewStyle} aria-label="Rotary wrap preview">
      <span>Surface circumference: {circumference.toFixed(2)} mm</span>
      <span>Machine travel per revolution: {machineWrap.toFixed(2)} mm</span>
    </div>
  );
}

function RotaryActions(props: {
  readonly draft: RotarySetup;
  readonly valid: boolean;
  readonly onCancel: () => void;
  readonly onApply: (setup: RotarySetup) => void;
  readonly onGenerateCalibration: (setup: RotarySetup) => void;
}): JSX.Element {
  return (
    <DialogActions>
      <Button onClick={props.onCancel}>Cancel</Button>
      <Button
        disabled={!props.valid || !props.draft.enabled}
        onClick={() => props.onGenerateCalibration(props.draft)}
      >
        Generate test pattern
      </Button>
      <Button variant="primary" disabled={!props.valid} onClick={() => props.onApply(props.draft)}>
        Apply
      </Button>
    </DialogActions>
  );
}

function SegmentButton(props: {
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

function FieldRow(props: {
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

function validRotarySetup(setup: RotarySetup): boolean {
  return (
    Number.isFinite(setup.objectDiameterMm) &&
    setup.objectDiameterMm > 0 &&
    Number.isFinite(setup.mmPerRotation) &&
    setup.mmPerRotation > 0
  );
}

const toggleStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 };
const fieldRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '140px minmax(0, 1fr)',
  gap: 8,
  alignItems: 'center',
};
const fieldLabelStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const fieldControlStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const segmentStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr' };
const segmentButtonStyle: React.CSSProperties = { borderRadius: 0, minWidth: 74 };
const segmentActiveStyle: React.CSSProperties = {
  background: 'var(--lf-accent)',
  color: 'var(--lf-on-fill)',
};
const numberStyle: React.CSSProperties = { width: 110 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const previewStyle: React.CSSProperties = {
  display: 'grid',
  gap: 3,
  padding: 8,
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  fontSize: 12,
};
const errorStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-danger)', fontSize: 12 };
