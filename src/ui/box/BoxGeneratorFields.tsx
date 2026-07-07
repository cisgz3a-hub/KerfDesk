// BoxGeneratorFields — the Box Generator form grid (split from the dialog
// for the component-size cap): dimensions with the inner/outer toggle,
// style, material and fit fields. The relief tool field only exists in CNC
// mode (gate-and-hide, ADR-101 / F-K3).

import type { ChangeEvent, CSSProperties } from 'react';
import { CalibrationNumberField } from '../calibration/CalibrationNumberField';
import type { BoxDraft, BoxMachineContext } from './box-draft';

export type BoxFieldSetter = (
  field: keyof BoxDraft,
) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

export function BoxGeneratorFields(props: {
  readonly draft: BoxDraft;
  readonly machine: BoxMachineContext;
  readonly setField: BoxFieldSetter;
}): JSX.Element {
  const { draft, setField } = props;
  return (
    <div style={fieldStackStyle}>
      <MaterialFields draft={draft} setField={setField} />
      <div style={gridStyle}>
        <DimensionFields draft={draft} setField={setField} />
        <FitFields draft={draft} machine={props.machine} setField={setField} />
      </div>
    </div>
  );
}

function MaterialFields(props: {
  readonly draft: BoxDraft;
  readonly setField: BoxFieldSetter;
}): JSX.Element {
  const { draft, setField } = props;
  return (
    <div style={materialRowStyle}>
      <MmField
        label="Material thickness (mm)"
        value={draft.thickness}
        min={0.1}
        onChange={setField('thickness')}
      />
    </div>
  );
}

function DimensionFields(props: {
  readonly draft: BoxDraft;
  readonly setField: BoxFieldSetter;
}): JSX.Element {
  const { draft, setField } = props;
  return (
    <>
      <MmField label="Width" value={draft.width} min={1} onChange={setField('width')} />
      <MmField label="Depth" value={draft.depth} min={1} onChange={setField('depth')} />
      <MmField label="Height" value={draft.height} min={1} onChange={setField('height')} />
      <SelectField
        label="Dimensions are"
        value={draft.mode}
        options={[
          ['inner', 'Inner (contents)'],
          ['outer', 'Outer'],
        ]}
        onChange={setField('mode')}
      />
      <SelectField
        label="Style"
        value={draft.style}
        options={[
          ['closed', 'Closed (6 panels)'],
          ['open-top', 'Open top (5 panels)'],
        ]}
        onChange={setField('style')}
      />
    </>
  );
}

function FitFields(props: {
  readonly draft: BoxDraft;
  readonly machine: BoxMachineContext;
  readonly setField: BoxFieldSetter;
}): JSX.Element {
  const { draft, setField } = props;
  return (
    <>
      <MmField
        label="Finger width"
        value={draft.fingerWidth}
        min={0.1}
        onChange={setField('fingerWidth')}
      />
      <MmField
        label="Clearance"
        value={draft.clearance}
        min={-5}
        max={5}
        onChange={setField('clearance')}
      />
      <CalibrationNumberField
        label="Part spacing"
        value={draft.partSpacing}
        min={0}
        max={undefined}
        step={1}
        onChange={setField('partSpacing')}
      />
      {props.machine.kind === 'cnc' ? (
        <SelectField
          label="Corner relief"
          value={draft.relief === 'off' ? 'off' : 'on'}
          options={[
            ['on', 'On (dogbones — tabs seat)'],
            ['off', 'Off (sharp corners)'],
          ]}
          onChange={setField('relief')}
        />
      ) : null}
      {props.machine.kind === 'cnc' && draft.relief !== 'off' ? (
        <MmField
          label="Relief tool diameter"
          value={draft.toolDiameter}
          min={0.1}
          onChange={setField('toolDiameter')}
        />
      ) : null}
    </>
  );
}

// Free-form mm field: real validation lives in validateBoxSpec, so native
// step validation is disabled (a misaligned step would block submission).
function MmField(props: {
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max?: number;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <CalibrationNumberField
      label={props.label}
      value={props.value}
      min={props.min}
      max={props.max}
      step="any"
      onChange={props.onChange}
    />
  );
}

function SelectField(props: {
  readonly label: string;
  readonly value: string;
  readonly options: ReadonlyArray<readonly [string, string]>;
  readonly onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}): JSX.Element {
  return (
    <label style={selectLabelStyle}>
      <span>{props.label}</span>
      <select
        className="lf-input"
        aria-label={props.label}
        title={`Choose ${props.label.toLowerCase()} for the generated box.`}
        value={props.value}
        onChange={props.onChange}
        style={{ width: '100%' }}
      >
        {props.options.map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

const fieldStackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const materialRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(180px, 1fr) 2fr',
  gap: 8,
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 8,
};

const selectLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
};
