import { useState, type ChangeEvent } from 'react';
import type { IntervalTestGridOptions } from '../../core/job';
import { CalibrationNumberField } from './CalibrationNumberField';
import { Button, Dialog, DialogActions } from '../kit';
import { calibrationGridStyle } from './calibration-dialog-styles';

type IntervalTestDraft = {
  readonly steps: string;
  readonly speed: string;
  readonly power: string;
  readonly intervalMinMm: string;
  readonly intervalMaxMm: string;
  readonly swatchSizeMm: string;
  readonly gapMm: string;
};

type IntervalTestField = {
  readonly key: keyof IntervalTestDraft;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
};

const DEFAULT_DRAFT: IntervalTestDraft = {
  steps: '10',
  speed: '1500',
  power: '30',
  intervalMinMm: '0.08',
  intervalMaxMm: '0.2',
  swatchSizeMm: '8',
  gapMm: '2',
};

const FIELD_SPECS: ReadonlyArray<IntervalTestField> = [
  { key: 'steps', label: 'Steps', min: 1, max: 20, step: undefined },
  { key: 'speed', label: 'Speed', min: 1, max: undefined, step: undefined },
  { key: 'power', label: 'Power', min: 0, max: 100, step: undefined },
  { key: 'intervalMinMm', label: 'Min interval', min: 0.05, max: undefined, step: 0.01 },
  { key: 'intervalMaxMm', label: 'Max interval', min: 0.05, max: undefined, step: 0.01 },
  { key: 'swatchSizeMm', label: 'Swatch size', min: 1, max: undefined, step: 0.1 },
  { key: 'gapMm', label: 'Gap', min: 0, max: undefined, step: 0.1 },
];

export function IntervalTestDialog(props: {
  readonly onCancel: () => void;
  readonly onGenerate: (options: IntervalTestGridOptions) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const setField =
    (field: keyof IntervalTestDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };
  // kit Dialog adds the Escape/focus-trap behavior these two dialogs were
  // missing (every other modal had it via use-dialog-a11y).
  return (
    <Dialog
      onClose={props.onCancel}
      title="Interval Test"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onGenerate(parseDraft(draft));
      }}
      size="sm"
    >
      <IntervalTestFields draft={draft} setField={setField} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function IntervalTestFields(props: {
  readonly draft: IntervalTestDraft;
  readonly setField: (
    field: keyof IntervalTestDraft,
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

function parseDraft(draft: IntervalTestDraft): IntervalTestGridOptions {
  return {
    steps: numberValue(draft.steps),
    speed: numberValue(draft.speed),
    power: numberValue(draft.power),
    intervalMinMm: numberValue(draft.intervalMinMm),
    intervalMaxMm: numberValue(draft.intervalMaxMm),
    swatchSizeMm: numberValue(draft.swatchSizeMm),
    gapMm: numberValue(draft.gapMm),
  };
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
