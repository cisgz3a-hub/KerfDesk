import { useState, type ChangeEvent } from 'react';
import type { ScanOffsetCalibrationPatternOptions } from '../../core/job';
import { Button, Dialog, DialogActions } from '../kit';
import { CalibrationNumberField } from './CalibrationNumberField';
import { calibrationGridStyle } from './calibration-dialog-styles';

type CalibrationMode = 'baseline' | 'verification';

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
  swatchWidthMm: '50',
  swatchHeightMm: '10',
  hatchSpacingMm: '0.5',
  overscanMm: '5',
  gapMm: '4',
};

const FIELD_SPECS: ReadonlyArray<ScanOffsetCalibrationField> = [
  { key: 'steps', label: 'Steps', min: 1, max: 10, step: undefined },
  { key: 'speedMin', label: 'Min speed (mm/min)', min: 1, max: undefined, step: undefined },
  { key: 'speedMax', label: 'Max speed (mm/min)', min: 1, max: undefined, step: undefined },
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
  readonly maxFeedMmPerMin?: number;
  readonly hasCalibratedOffsets?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(() => initialDraft(props.maxFeedMmPerMin));
  const [mode, setMode] = useState<CalibrationMode>('baseline');
  const errors = validationMessages(draft, mode);
  const warnings = qualificationWarnings(
    draft,
    mode,
    props.maxFeedMmPerMin,
    props.hasCalibratedOffsets ?? false,
  );
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
        if (errors.length > 0) return;
        props.onGenerate(parseDraft(draft, mode));
      }}
      size="sm"
    >
      <CalibrationPurpose mode={mode} setMode={setMode} />
      <strong style={stepLabelStyle}>2. Coupon geometry and burn settings</strong>
      <ScanOffsetCalibrationFields draft={draft} setField={setField} />
      <CalibrationFeedback errors={errors} warnings={warnings} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary">
          {mode === 'baseline' ? 'Generate uncorrected baseline' : 'Generate verification coupon'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CalibrationPurpose(props: {
  readonly mode: CalibrationMode;
  readonly setMode: (mode: CalibrationMode) => void;
}): JSX.Element {
  return (
    <>
      <label style={purposeStyle}>
        <span>1. Coupon purpose</span>
        <select
          className="lf-input"
          aria-label="Coupon purpose"
          title="Choose an uncorrected baseline coupon or a coupon that verifies the saved scan-offset table."
          value={props.mode}
          onChange={(event) => props.setMode(event.target.value as CalibrationMode)}
        >
          <option value="baseline">Uncorrected baseline</option>
          <option value="verification">Verify saved table</option>
        </select>
      </label>
      <p style={guidanceStyle}>
        {props.mode === 'baseline'
          ? 'Baseline forces 0 mm scan correction and deliberately permits bidirectional rows, even when the profile normally requires verified offsets. Use low power on scrap after checking belts, focus, and optics.'
          : 'Verification keeps the active profile scan-offset table. If no measured values are saved, the coupon remains a valid uncorrected comparison; inspect alternating edges physically.'}
      </p>
    </>
  );
}

function CalibrationFeedback(props: {
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}): JSX.Element {
  return (
    <>
      {props.warnings.length > 0 ? (
        <div role="status" style={warningStyle}>
          <strong>Qualification warning — generation remains available</strong>
          <ul style={feedbackListStyle}>
            {props.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.errors.length > 0 ? (
        <div role="alert" style={errorStyle}>
          <strong>Cannot produce a valid coupon from these values</strong>
          <ul style={feedbackListStyle}>
            {props.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p style={guidanceStyle}>
          After burning: measure the full signed forward-versus-reverse separation. Do not divide
          the measurement in half. KerfDesk moves reverse rows only.
        </p>
      )}
    </>
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

function parseDraft(
  draft: ScanOffsetCalibrationDraft,
  mode: CalibrationMode,
): ScanOffsetCalibrationPatternOptions {
  return {
    mode,
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

function initialDraft(maxFeedMmPerMin: number | undefined): ScanOffsetCalibrationDraft {
  if (!isFinitePositive(maxFeedMmPerMin)) return DEFAULT_DRAFT;
  const speedMax = Math.max(1, Math.min(Number(DEFAULT_DRAFT.speedMax), maxFeedMmPerMin));
  const speedMin = Math.max(1, Math.min(Number(DEFAULT_DRAFT.speedMin), speedMax));
  return { ...DEFAULT_DRAFT, speedMin: String(speedMin), speedMax: String(speedMax) };
}

function validationMessages(
  draft: ScanOffsetCalibrationDraft,
  mode: CalibrationMode,
): ReadonlyArray<string> {
  const options = parseDraft(draft, mode);
  return [
    ...validateSteps(options),
    ...validateSpeeds(options),
    ...validatePower(options),
    ...validateGeometry(options),
  ];
}

function qualificationWarnings(
  draft: ScanOffsetCalibrationDraft,
  mode: CalibrationMode,
  maxFeedMmPerMin: number | undefined,
  hasCalibratedOffsets: boolean,
): ReadonlyArray<string> {
  const options = parseDraft(draft, mode);
  const warnings: string[] = [];
  if (mode === 'baseline') {
    warnings.push(
      'This baseline intentionally emits uncorrected bidirectional rows. Use low power on scrap and verify belts, focus, and optics before interpreting the result.',
    );
  }
  if (mode === 'verification' && !hasCalibratedOffsets) {
    warnings.push(
      'The active profile has no measured scan-offset points. This coupon will be an uncorrected comparison, not proof of calibrated alignment.',
    );
  }
  if (isFinitePositive(maxFeedMmPerMin) && options.speedMax > maxFeedMmPerMin) {
    warnings.push(
      `Requested maximum speed ${options.speedMax} mm/min exceeds the profile ceiling of ${maxFeedMmPerMin} mm/min; compiled output will disclose and use its effective capped feed.`,
    );
  }
  return warnings;
}

function validateSteps(options: ScanOffsetCalibrationPatternOptions): ReadonlyArray<string> {
  if (!Number.isInteger(options.steps) || options.steps < 1 || options.steps > 10) {
    return ['Steps must be a whole number from 1 to 10.'];
  }
  return [];
}

function validateSpeeds(options: ScanOffsetCalibrationPatternOptions): ReadonlyArray<string> {
  if (!isFinitePositive(options.speedMin) || !isFinitePositive(options.speedMax)) {
    return ['Minimum and maximum speed must be positive numbers.'];
  }
  if (options.speedMin > options.speedMax) {
    return ['Minimum speed cannot exceed maximum speed.'];
  }
  return [];
}

function validatePower(options: ScanOffsetCalibrationPatternOptions): ReadonlyArray<string> {
  return options.power < 0 || options.power > 100 ? ['Power must be between 0% and 100%.'] : [];
}

function validateGeometry(options: ScanOffsetCalibrationPatternOptions): ReadonlyArray<string> {
  const errors: string[] = [];
  if (!isFinitePositive(options.swatchWidthMm) || !isFinitePositive(options.swatchHeightMm)) {
    errors.push('Swatch width and height must be positive.');
  }
  if (!isFinitePositive(options.hatchSpacingMm)) errors.push('Line interval must be positive.');
  if ((options.overscanMm ?? 0) < 0 || (options.gapMm ?? 0) < 0) {
    errors.push('Overscan and gap cannot be negative.');
  }
  return errors;
}

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFinitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

const purposeStyle: React.CSSProperties = {
  display: 'grid',
  gap: 4,
  fontSize: 12,
  fontWeight: 600,
};
const guidanceStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.45,
};
const stepLabelStyle: React.CSSProperties = { fontSize: 12 };
const errorStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  border: '1px solid color-mix(in srgb, var(--lf-danger) 55%, transparent)',
  borderRadius: 6,
  color: 'var(--lf-danger)',
  fontSize: 12,
};
const warningStyle: React.CSSProperties = {
  margin: 0,
  padding: 10,
  border: '1px solid color-mix(in srgb, var(--lf-warning) 65%, transparent)',
  borderRadius: 6,
  color: 'var(--lf-warning)',
  fontSize: 12,
};
const feedbackListStyle: React.CSSProperties = { margin: '4px 0 0', paddingLeft: 18 };
