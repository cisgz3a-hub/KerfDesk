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
  readonly maxFeedMmPerMin?: number;
  readonly hasCalibratedOffsets?: boolean;
}): JSX.Element {
  const [draft, setDraft] = useState(() => initialDraft(props.maxFeedMmPerMin));
  const [mode, setMode] = useState<CalibrationMode>('baseline');
  const [expertOverrideAccepted, setExpertOverrideAccepted] = useState(false);
  const errors = validationMessages(
    draft,
    mode,
    expertOverrideAccepted,
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
      <CalibrationPurpose
        mode={mode}
        expertOverrideAccepted={expertOverrideAccepted}
        setMode={setMode}
        setExpertOverrideAccepted={setExpertOverrideAccepted}
      />
      <strong style={stepLabelStyle}>2. Coupon geometry and burn settings</strong>
      <ScanOffsetCalibrationFields draft={draft} setField={setField} />
      <CalibrationFeedback errors={errors} />
      <DialogActions>
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={errors.length > 0}>
          {mode === 'baseline' ? 'Generate uncorrected baseline' : 'Generate verification coupon'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CalibrationPurpose(props: {
  readonly mode: CalibrationMode;
  readonly expertOverrideAccepted: boolean;
  readonly setMode: (mode: CalibrationMode) => void;
  readonly setExpertOverrideAccepted: (accepted: boolean) => void;
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
          ? 'Baseline forces 0 mm scan correction and deliberately permits bidirectional rows, even on an uncalibrated 4040. Use low power on scrap after checking belts, focus, and optics.'
          : 'Verification keeps the active profile scan-offset table. Generate it only after applying measured values, then compare alternating edges physically.'}
      </p>
      {props.mode === 'baseline' ? (
        <label style={acknowledgementStyle}>
          <input
            type="checkbox"
            aria-label="Accept uncorrected bidirectional calibration override"
            title="Allow this baseline coupon to use uncorrected bidirectional rows despite the protective one-way fallback."
            checked={props.expertOverrideAccepted}
            onChange={(event) => props.setExpertOverrideAccepted(event.target.checked)}
          />
          <span>
            I understand this test intentionally bypasses the protective one-way fallback and burns
            uncorrected bidirectional rows.
          </span>
        </label>
      ) : null}
    </>
  );
}

function CalibrationFeedback(props: { readonly errors: ReadonlyArray<string> }): JSX.Element {
  if (props.errors.length === 0) {
    return (
      <p style={guidanceStyle}>
        After burning: measure the full signed forward-versus-reverse separation. Do not divide the
        measurement in half. KerfDesk moves reverse rows only.
      </p>
    );
  }
  return (
    <ul role="alert" style={errorStyle}>
      {props.errors.map((error) => (
        <li key={error}>{error}</li>
      ))}
    </ul>
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
  expertOverrideAccepted: boolean,
  maxFeedMmPerMin: number | undefined,
  hasCalibratedOffsets: boolean,
): ReadonlyArray<string> {
  const options = parseDraft(draft, mode);
  return [
    ...validateSteps(options),
    ...validateSpeeds(options, maxFeedMmPerMin),
    ...validatePower(options),
    ...validateGeometry(options),
    ...validatePurpose(mode, expertOverrideAccepted, hasCalibratedOffsets),
  ];
}

function validateSteps(options: ScanOffsetCalibrationPatternOptions): ReadonlyArray<string> {
  if (!Number.isInteger(options.steps) || options.steps < 1 || options.steps > 10) {
    return ['Steps must be a whole number from 1 to 10.'];
  }
  return [];
}

function validateSpeeds(
  options: ScanOffsetCalibrationPatternOptions,
  maxFeedMmPerMin: number | undefined,
): ReadonlyArray<string> {
  if (!isFinitePositive(options.speedMin) || !isFinitePositive(options.speedMax)) {
    return ['Minimum and maximum speed must be positive numbers.'];
  }
  if (options.speedMin > options.speedMax) {
    return ['Minimum speed cannot exceed maximum speed.'];
  }
  if (isFinitePositive(maxFeedMmPerMin) && options.speedMax > maxFeedMmPerMin) {
    return [`Maximum speed cannot exceed this profile's ${maxFeedMmPerMin} mm/min limit.`];
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

function validatePurpose(
  mode: CalibrationMode,
  expertOverrideAccepted: boolean,
  hasCalibratedOffsets: boolean,
): ReadonlyArray<string> {
  const errors: string[] = [];
  if (mode === 'baseline' && !expertOverrideAccepted) {
    errors.push('Acknowledge the intentional uncorrected bidirectional override.');
  }
  if (mode === 'verification' && !hasCalibratedOffsets) {
    errors.push('Apply at least one measured scan-offset point before generating verification.');
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
const acknowledgementStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12,
  lineHeight: 1.4,
};
const stepLabelStyle: React.CSSProperties = { fontSize: 12 };
const errorStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  color: 'var(--lf-danger)',
  fontSize: 12,
};
