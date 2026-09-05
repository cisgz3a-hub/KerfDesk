import { useState, type ChangeEvent } from 'react';
import type { MaterialTestGridOptions } from '../../core/job';
import { CalibrationNumberField } from './CalibrationNumberField';
import { Button, Dialog, DialogActions } from '../kit';
import { persistCalibrationDraft, restoreCalibrationDraft } from './calibration-draft-storage';
import { calibrationGridStyle } from './calibration-dialog-styles';
import { calibrationDraftIssues } from './calibration-draft-validation';

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

const MATERIAL_TEST_DRAFT_KEY = 'laserforge.calibration.materialTestDraft.v1';
const MATERIAL_TEST_DRAFT_FIELDS = Object.keys(DEFAULT_DRAFT) as ReadonlyArray<
  keyof MaterialTestDraft
>;

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
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(MATERIAL_TEST_DRAFT_KEY, DEFAULT_DRAFT, MATERIAL_TEST_DRAFT_FIELDS),
  );
  const issues = calibrationDraftIssues(draft, FIELD_SPECS);
  const setField =
    (field: keyof MaterialTestDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };
  // kit Dialog adds the Escape/focus-trap behavior these two dialogs were
  // missing (every other modal had it via use-dialog-a11y).
  return (
    <Dialog
      onClose={props.onCancel}
      title="Material Test"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (issues.length > 0) return;
        persistCalibrationDraft(MATERIAL_TEST_DRAFT_KEY, draft);
        props.onGenerate(parseDraft(draft));
      }}
      size="sm"
    >
      <MaterialTestFields draft={draft} setField={setField} />
      {issues.length > 0 ? <p role="alert">{issues.join(' ')}</p> : null}
      <CalibrationFeedDisclosure
        speedMin={numberValue(draft.speedMin)}
        speedMax={numberValue(draft.speedMax)}
        maxFeedMmPerMin={props.maxFeedMmPerMin}
      />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={issues.length > 0}>
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CalibrationFeedDisclosure(props: {
  readonly speedMin: number;
  readonly speedMax: number;
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const requestedLow = Math.min(props.speedMin, props.speedMax);
  const requestedHigh = Math.max(props.speedMin, props.speedMax);
  const effectiveLow = Math.min(requestedLow, props.maxFeedMmPerMin);
  const effectiveHigh = Math.min(requestedHigh, props.maxFeedMmPerMin);
  return (
    <p role="status" style={{ margin: '12px 0 0', color: 'var(--lf-text-muted)', fontSize: 12 }}>
      Requested {formatFeed(requestedLow)}–{formatFeed(requestedHigh)} mm/min; effective{' '}
      {formatFeed(effectiveLow)}–{formatFeed(effectiveHigh)} mm/min with the active profile ceiling
      of {formatFeed(props.maxFeedMmPerMin)} mm/min. Burned row labels show effective feed.
    </p>
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
  return value.trim() === '' ? Number.NaN : Number(value);
}

function formatFeed(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '0';
}
