import { useState, type ChangeEvent } from 'react';
import type { MaterialTestGridOptions } from '../../core/job';
import { CalibrationNumberField } from './CalibrationNumberField';
import {
  calibrationBackdropStyle,
  calibrationButtonRowStyle,
  calibrationDialogStyle,
  calibrationGridStyle,
  calibrationHeadingStyle,
} from './calibration-dialog-styles';

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
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="material-test-title"
      style={calibrationBackdropStyle}
    >
      <form
        style={calibrationDialogStyle}
        onSubmit={(event) => {
          event.preventDefault();
          props.onGenerate(parseDraft(draft));
        }}
      >
        <h2 id="material-test-title" style={calibrationHeadingStyle}>
          Material Test
        </h2>
        <MaterialTestFields draft={draft} setField={setField} />
        <div style={calibrationButtonRowStyle}>
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
    <div style={calibrationGridStyle}>
      {FIELD_SPECS.map((field) => (
        <CalibrationNumberField
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
