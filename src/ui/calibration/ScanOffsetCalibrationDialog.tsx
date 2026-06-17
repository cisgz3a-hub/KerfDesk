import { useState, type ChangeEvent } from 'react';
import type { ScanOffsetCalibrationPatternOptions } from '../../core/job';
import { Button, Dialog, DialogActions } from '../kit';
import { CalibrationNumberField } from './CalibrationNumberField';
import { calibrationGridStyle } from './calibration-dialog-styles';

type ScanOffsetCalibrationDraft = {
  readonly steps: string;
  readonly speedMin: string;
  readonly speedMax: string;
  readonly power: string;
  readonly swatchWidthMm: string;
  readonly swatchHeightMm: string;
  readonly hatchSpacingMm: string;
  readonly overscanMm: string;
  readonly gapMm: string;
};

type ScanOffsetCalibrationField = {
  readonly key: keyof ScanOffsetCalibrationDraft;
  readonly label: string;
  readonly min: number;
  readonly max: number | undefined;
  readonly step: number | undefined;
};

const DEFAULT_DRAFT: ScanOffsetCalibrationDraft = {
  steps: '5',
  speedMin: '1000',
  speedMax: '5000',
  power: '12',
  swatchWidthMm: '18',
  swatchHeightMm: '6',
  hatchSpacingMm: '0.5',
  overscanMm: '5',
  gapMm: '4',
};

const FIELD_SPECS: ReadonlyArray<ScanOffsetCalibrationField> = [
  { key: 'steps', label: 'Steps', min: 1, max: 10, step: undefined },
  { key: 'speedMin', label: 'Min speed', min: 1, max: undefined, step: undefined },
  { key: 'speedMax', label: 'Max speed', min: 1, max: undefined, step: undefined },
  { key: 'power', label: 'Power', min: 0, max: 100, step: undefined },
  { key: 'swatchWidthMm', label: 'Swatch width', min: 1, max: undefined, step: 0.1 },
  { key: 'swatchHeightMm', label: 'Swatch height', min: 1, max: undefined, step: 0.1 },
  { key: 'hatchSpacingMm', label: 'Line interval', min: 0.05, max: undefined, step: 0.01 },
  { key: 'overscanMm', label: 'Overscan', min: 0, max: undefined, step: 0.1 },
  { key: 'gapMm', label: 'Gap', min: 0, max: undefined, step: 0.1 },
];

export function ScanOffsetCalibrationDialog(props: {
  readonly onCancel: () => void;
  readonly onGenerate: (options: ScanOffsetCalibrationPatternOptions) => void;
}): JSX.Element {
  const [draft, setDraft] = useState(DEFAULT_DRAFT);
  const setField =
    (field: keyof ScanOffsetCalibrationDraft) =>
    (event: ChangeEvent<HTMLInputElement>): void => {
      const { value } = event.target;
      setDraft((current) => ({ ...current, [field]: value }));
    };
  return (
    <Dialog
      onClose={props.onCancel}
      title="Scan Offset Test"
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onGenerate(parseDraft(draft));
      }}
      size="sm"
    >
      <ScanOffsetCalibrationFields draft={draft} setField={setField} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          Generate
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ScanOffsetCalibrationFields(props: {
  readonly draft: ScanOffsetCalibrationDraft;
  readonly setField: (
    field: keyof ScanOffsetCalibrationDraft,
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

function parseDraft(draft: ScanOffsetCalibrationDraft): ScanOffsetCalibrationPatternOptions {
  return {
    steps: numberValue(draft.steps),
    speedMin: numberValue(draft.speedMin),
    speedMax: numberValue(draft.speedMax),
    power: numberValue(draft.power),
    swatchWidthMm: numberValue(draft.swatchWidthMm),
    swatchHeightMm: numberValue(draft.swatchHeightMm),
    hatchSpacingMm: numberValue(draft.hatchSpacingMm),
    overscanMm: numberValue(draft.overscanMm),
    gapMm: numberValue(draft.gapMm),
  };
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
