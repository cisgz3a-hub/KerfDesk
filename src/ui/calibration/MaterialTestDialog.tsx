import { useState, type CSSProperties, type ChangeEvent } from 'react';
import type { MaterialTestGridOptions } from '../../core/job';

type MaterialTestDraft = {
  readonly rows: string;
  readonly columns: string;
  readonly speedMin: string;
  readonly speedMax: string;
  readonly powerMin: string;
  readonly powerMax: string;
  readonly cellWidthMm: string;
  readonly cellHeightMm: string;
  readonly gapMm: string;
};

type MaterialTestField = {
  readonly key: keyof MaterialTestDraft;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
};

const DEFAULT_DRAFT: MaterialTestDraft = {
  rows: '10',
  columns: '10',
  speedMin: '1000',
  speedMax: '3000',
  powerMin: '10',
  powerMax: '40',
  cellWidthMm: '5',
  cellHeightMm: '5',
  gapMm: '1',
};

const FIELD_SPECS: ReadonlyArray<MaterialTestField> = [
  { key: 'rows', label: 'Rows', min: 1, max: 20, step: undefined },
  { key: 'columns', label: 'Columns', min: 1, max: 20, step: undefined },
  { key: 'speedMin', label: 'Min speed', min: 1, max: undefined, step: undefined },
  { key: 'speedMax', label: 'Max speed', min: 1, max: undefined, step: undefined },
  { key: 'powerMin', label: 'Min power', min: 0, max: 100, step: undefined },
  { key: 'powerMax', label: 'Max power', min: 0, max: 100, step: undefined },
  { key: 'cellWidthMm', label: 'Cell width', min: 0.1, max: undefined, step: 0.1 },
  { key: 'cellHeightMm', label: 'Cell height', min: 0.1, max: undefined, step: 0.1 },
  { key: 'gapMm', label: 'Gap', min: 0, max: undefined, step: 0.1 },
];

export function MaterialTestDialog(props: {
  readonly onCancel: () => void;
  readonly onGenerate: (options: MaterialTestGridOptions) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const setField =
    (field: keyof MaterialTestDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      setDraft((current) => ({ ...current, [field]: event.target.value }));
    };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-test-title"
      style={backdropStyle}
    >
      <form
        style={dialogStyle}
        onSubmit={(event) => {
          event.preventDefault();
          props.onGenerate(parseDraft(draft));
        }}
      >
        <h2 id="material-test-title" style={headingStyle}>
          Material Test
        </h2>
        <MaterialTestFields draft={draft} setField={setField} />
        <div style={buttonRowStyle}>
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit">Generate</button>
        </div>
      </form>
    </div>
  );
}

function MaterialTestFields(props: {
  readonly draft: MaterialTestDraft;
  readonly setField: (
    field: keyof MaterialTestDraft,
  ) => (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <div style={gridStyle}>
      {FIELD_SPECS.map((field) => (
        <NumberField
          key={field.key}
          label={field.label}
          value={props.draft[field.key]}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={props.setField(field.key)}
        />
      ))}
    </div>
  );
}

function NumberField(props: {
  readonly label: string;
  readonly value: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span>{props.label}</span>
      <input
        type="number"
        aria-label={props.label}
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step ?? 1}
        onChange={props.onChange}
        style={inputStyle}
      />
    </label>
  );
}

function parseDraft(draft: MaterialTestDraft): MaterialTestGridOptions {
  return {
    rows: numberValue(draft.rows),
    columns: numberValue(draft.columns),
    speedMin: numberValue(draft.speedMin),
    speedMax: numberValue(draft.speedMax),
    powerMin: numberValue(draft.powerMin),
    powerMax: numberValue(draft.powerMax),
    cellWidthMm: numberValue(draft.cellWidthMm),
    cellHeightMm: numberValue(draft.cellHeightMm),
    gapMm: numberValue(draft.gapMm),
  };
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.35)',
};
const dialogStyle: CSSProperties = {
  width: 380,
  maxWidth: 'calc(100vw - 32px)',
  background: '#fff',
  color: '#111',
  border: '1px solid #bbb',
  borderRadius: 6,
  padding: 14,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.24)',
};
const headingStyle: CSSProperties = { margin: '0 0 12px 0', fontSize: 16 };
const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
};
const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
};
const inputStyle: CSSProperties = { padding: '4px 6px' };
const buttonRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 14,
};
