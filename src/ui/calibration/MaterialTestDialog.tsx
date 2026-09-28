import { useState, type ChangeEvent, type CSSProperties } from 'react';
import type { MaterialTestGridOptions } from '../../core/job';
import type { MaterialTestParameter } from '../../core/job/material-test-axes';
import { materialTestRunwayMm } from '../../core/job/material-test-grid';
import { CalibrationNumberField } from './CalibrationNumberField';
import { Button, Dialog, DialogActions } from '../kit';
import { persistCalibrationDraft, restoreCalibrationDraft } from './calibration-draft-storage';
import { calibrationFieldStyle, calibrationGridStyle } from './calibration-dialog-styles';
import { calibrationDraftIssues } from './calibration-draft-validation';
import {
  DEFAULT_MATERIAL_TEST_DRAFT,
  MATERIAL_TEST_DRAFT_FIELDS,
  MATERIAL_TEST_PARAMETER_NAMES,
  materialTestAxes,
  materialTestFields,
  materialTestMode,
  materialTestParameters,
  numberValue,
  parseMaterialTestDraft,
  withMaterialTestChoice,
  type MaterialTestDraft,
  type MaterialTestNumberKey,
} from './material-test-draft';

const MATERIAL_TEST_DRAFT_KEY = 'laserforge.calibration.materialTestDraft.v1';
// A Fill's stored runway, which an engraved grid never runs shorter (ADR-497).
const STORED_FILL_RUNWAY_MM = 5;

export function MaterialTestDialog(props: {
  readonly onCancel: () => void;
  readonly onGenerate: (options: MaterialTestGridOptions) => void;
  readonly maxFeedMmPerMin: number;
  /** Machine Setup acceleration, for the engraved rows' runway note. */
  readonly accelMmPerSec2?: number;
}): JSX.Element {
  const [draft, setDraft] = useState(() =>
    restoreCalibrationDraft(
      MATERIAL_TEST_DRAFT_KEY,
      DEFAULT_MATERIAL_TEST_DRAFT,
      MATERIAL_TEST_DRAFT_FIELDS,
    ),
  );
  const fields = materialTestFields(draft);
  const issues = calibrationDraftIssues(draft, fields);
  const setField =
    (field: MaterialTestNumberKey) =>
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
        props.onGenerate(parseMaterialTestDraft(draft));
      }}
      size="sm"
    >
      <MaterialTestChoices
        draft={draft}
        choose={(choice, value) =>
          setDraft((current) => withMaterialTestChoice(current, choice, value))
        }
      />
      <div style={calibrationGridStyle}>
        {fields.map((field) => (
          <CalibrationNumberField
            key={field.key}
            label={field.label}
            value={draft[field.key]}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={setField(field.key)}
          />
        ))}
      </div>
      {issues.length > 0 ? <p role="alert">{issues.join(' ')}</p> : null}
      <CalibrationFeedDisclosure draft={draft} maxFeedMmPerMin={props.maxFeedMmPerMin} />
      <RunwayNote
        draft={draft}
        maxFeedMmPerMin={props.maxFeedMmPerMin}
        accelMmPerSec2={props.accelMmPerSec2}
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

function MaterialTestChoices(props: {
  readonly draft: MaterialTestDraft;
  readonly choose: (choice: 'mode' | 'rowParameter' | 'columnParameter', value: string) => void;
}): JSX.Element {
  const [row, column] = materialTestAxes(props.draft);
  const parameters = materialTestParameters(materialTestMode(props.draft));
  return (
    <div style={{ ...calibrationGridStyle, gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
      <ChoiceField
        label="Test"
        title="Engrave fills each cell; Cut burns each cell's outline, to find the settings that cut through."
        value={materialTestMode(props.draft)}
        options={[
          ['fill', 'Engrave'],
          ['line', 'Cut'],
        ]}
        onChange={(value) => props.choose('mode', value)}
      />
      <ChoiceField
        label="Rows vary"
        title="The setting that changes from row to row."
        value={row}
        options={parameterOptions(parameters)}
        onChange={(value) => props.choose('rowParameter', value)}
      />
      <ChoiceField
        label="Columns vary"
        title="The setting that changes from column to column."
        value={column}
        options={parameterOptions(parameters)}
        onChange={(value) => props.choose('columnParameter', value)}
      />
    </div>
  );
}

function ChoiceField(props: {
  readonly label: string;
  readonly title: string;
  readonly value: string;
  readonly options: ReadonlyArray<readonly [string, string]>;
  readonly onChange: (value: string) => void;
}): JSX.Element {
  return (
    <label style={calibrationFieldStyle}>
      <span>{props.label}</span>
      <select
        className="lf-input"
        aria-label={props.label}
        title={props.title}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        style={selectStyle}
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

function CalibrationFeedDisclosure(props: {
  readonly draft: MaterialTestDraft;
  readonly maxFeedMmPerMin: number;
}): JSX.Element {
  const [low, high] = speedRange(props.draft);
  const axis = speedAxis(props.draft);
  const effectiveLow = Math.min(low, props.maxFeedMmPerMin);
  const effectiveHigh = Math.min(high, props.maxFeedMmPerMin);
  return (
    <p role="status" style={noteStyle}>
      Requested {formatRange(low, high)} mm/min; effective{' '}
      {formatRange(effectiveLow, effectiveHigh)} mm/min with the active profile ceiling of{' '}
      {formatFeed(props.maxFeedMmPerMin)} mm/min.
      {axis === undefined ? '' : ` Burned ${axis} labels show effective feed.`}
    </p>
  );
}

// ADR-497: an engraved row runs 5 mm of runway, or what its fastest cell
// needs to reach speed; say so when that is longer.
function RunwayNote(props: {
  readonly draft: MaterialTestDraft;
  readonly maxFeedMmPerMin: number;
  readonly accelMmPerSec2: number | undefined;
}): JSX.Element | null {
  const accel = props.accelMmPerSec2;
  if (materialTestMode(props.draft) !== 'fill' || accel === undefined || !(accel > 0)) return null;
  const fastest = Math.min(speedRange(props.draft)[1], props.maxFeedMmPerMin);
  if (!Number.isFinite(fastest)) return null;
  const runwayMm = materialTestRunwayMm(fastest, accel);
  if (runwayMm <= STORED_FILL_RUNWAY_MM) return null;
  return (
    <p style={noteStyle}>
      The fastest engraved cells need {formatFeed(runwayMm)} mm of runway to reach{' '}
      {formatFeed(fastest)} mm/min at {formatFeed(accel)} mm/s² (Machine Setup), so their rows run
      that instead of the usual {STORED_FILL_RUNWAY_MM} mm and the grid leaves room for it on the
      left.
    </p>
  );
}

function speedRange(draft: MaterialTestDraft): readonly [number, number] {
  if (speedAxis(draft) === undefined) {
    const speed = numberValue(draft.speed);
    return [speed, speed];
  }
  const a = numberValue(draft.speedMin);
  const b = numberValue(draft.speedMax);
  return [Math.min(a, b), Math.max(a, b)];
}

function speedAxis(draft: MaterialTestDraft): 'row' | 'column' | undefined {
  const [row, column] = materialTestAxes(draft);
  if (row === 'speed') return 'row';
  return column === 'speed' ? 'column' : undefined;
}

function parameterOptions(
  parameters: ReadonlyArray<MaterialTestParameter>,
): ReadonlyArray<readonly [string, string]> {
  return parameters.map((parameter) => [parameter, MATERIAL_TEST_PARAMETER_NAMES[parameter]]);
}

function formatRange(low: number, high: number): string {
  return low === high ? formatFeed(low) : `${formatFeed(low)}–${formatFeed(high)}`;
}

function formatFeed(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '0';
}

const noteStyle: CSSProperties = {
  margin: '12px 0 0',
  color: 'var(--lf-text-muted)',
  fontSize: 12,
};
const selectStyle: CSSProperties = { width: '100%', boxSizing: 'border-box' };
