// Controls of the Material Test dialog (ADR-381): test mode, the two axes,
// the settings neither axis varies, grid layout and where the test goes.

import type { ChangeEvent, CSSProperties } from 'react';
import {
  MATERIAL_TEST_MAX_COUNT,
  MATERIAL_TEST_PARAMETERS,
  type MaterialTestParameter,
} from '../../core/job/material-test-axes';
import { CalibrationNumberField } from './CalibrationNumberField';
import { calibrationGridStyle } from './calibration-dialog-styles';
import {
  AXIS_KEYS,
  FIXED_KEYS,
  FIXED_LABELS,
  fixedParameters,
  modeChoice,
  parameterOf,
  testMode,
  valueRule,
  type MaterialTestDraft,
  type MaterialTestDraftKey,
  type MaterialTestModeChoice,
} from './material-test-draft';

export type MaterialTestFieldSetter = (
  key: MaterialTestDraftKey,
) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;

type FieldProps = {
  readonly draft: MaterialTestDraft;
  readonly setField: MaterialTestFieldSetter;
};

const MODE_OPTIONS: ReadonlyArray<{
  readonly value: MaterialTestModeChoice;
  readonly label: string;
}> = [
  { value: 'line', label: 'Line' },
  { value: 'fill', label: 'Fill' },
  { value: 'image-dithered', label: 'Image (dithered)' },
  { value: 'image-grayscale', label: 'Image (grayscale)' },
];

const PARAMETER_NAMES: Readonly<Record<MaterialTestParameter, string>> = {
  power: 'Power (%)',
  speed: 'Speed (mm/min)',
  interval: 'Interval (mm)',
  passes: 'Passes',
};

export function MaterialTestModeField(props: FieldProps): JSX.Element {
  const choice = modeChoice(props.draft.mode);
  return (
    <label style={fieldStyle}>
      <span>Test mode</span>
      <select
        className="lf-select"
        aria-label="Test mode"
        title="Burn each cell as outlines (Line), a hatch fill (Fill), or an image."
        value={choice}
        onChange={props.setField('mode')}
      >
        {MODE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {testMode(choice) === 'image' ? (
        <span style={hintStyle}>
          Each cell burns a five-step gray ramp, so one cell shows light and dark tones.
        </span>
      ) : null}
    </label>
  );
}

export function MaterialTestAxisRow(
  props: FieldProps & {
    readonly axis: 'row' | 'column';
    readonly onParameterChange: (parameter: MaterialTestParameter) => void;
  },
): JSX.Element {
  const keys = AXIS_KEYS[props.axis];
  const noun = props.axis === 'row' ? 'Row' : 'Column';
  const mode = testMode(modeChoice(props.draft.mode));
  const parameter = parameterOf(
    props.draft[keys.parameter],
    props.axis === 'row' ? 'speed' : 'power',
  );
  const rule = valueRule(parameter, mode);
  return (
    <div style={axisGridStyle}>
      <label style={fieldStyle}>
        <span>{noun}s vary</span>
        <select
          className="lf-select"
          aria-label={`${noun}s vary`}
          title={`Choose the setting that changes from ${props.axis} to ${props.axis}.`}
          value={parameter}
          onChange={(event) => props.onParameterChange(parameterOf(event.target.value, parameter))}
        >
          {MATERIAL_TEST_PARAMETERS.map((option) => (
            <option key={option} value={option} disabled={option === 'interval' && mode === 'line'}>
              {PARAMETER_NAMES[option]}
            </option>
          ))}
        </select>
      </label>
      <CalibrationNumberField
        label={`${noun} start`}
        value={props.draft[keys.start]}
        min={rule.min}
        max={rule.max}
        step={rule.step}
        onChange={props.setField(keys.start)}
      />
      <CalibrationNumberField
        label={`${noun} end`}
        value={props.draft[keys.end]}
        min={rule.min}
        max={rule.max}
        step={rule.step}
        onChange={props.setField(keys.end)}
      />
      <CalibrationNumberField
        label={`${noun}s`}
        value={props.draft[keys.count]}
        min={1}
        max={MATERIAL_TEST_MAX_COUNT}
        step={1}
        onChange={props.setField(keys.count)}
      />
    </div>
  );
}

/** Settings every cell shares: the ones neither axis varies, and air assist. */
export function MaterialTestFixedFields(
  props: FieldProps & { readonly onAirAssistChange: (on: boolean) => void },
): JSX.Element {
  const mode = testMode(modeChoice(props.draft.mode));
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Every cell</legend>
      <div style={calibrationGridStyle}>
        {fixedParameters(props.draft).map((parameter) => {
          const rule = valueRule(parameter, mode);
          return (
            <CalibrationNumberField
              key={parameter}
              label={FIXED_LABELS[parameter]}
              value={props.draft[FIXED_KEYS[parameter]]}
              min={rule.min}
              max={rule.max}
              step={rule.step}
              onChange={props.setField(FIXED_KEYS[parameter])}
            />
          );
        })}
      </div>
      <label style={checkStyle}>
        <input
          type="checkbox"
          className="lf-checkbox"
          aria-label="Air assist"
          title="Turn job-controlled air assist on for every cell."
          checked={props.draft.airAssist === 'on'}
          onChange={(event) => props.onAirAssistChange(event.target.checked)}
        />
        <span>Air assist</span>
      </label>
    </fieldset>
  );
}

export function MaterialTestLayoutFields(
  props: FieldProps & {
    readonly onToggle: (key: 'labels' | 'border', on: boolean) => void;
  },
): JSX.Element {
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Grid</legend>
      <div style={threeColumnStyle}>
        <CalibrationNumberField
          label="Cell width"
          value={props.draft.cellWidthMm}
          min={0.1}
          max={undefined}
          step={0.1}
          onChange={props.setField('cellWidthMm')}
        />
        <CalibrationNumberField
          label="Cell height"
          value={props.draft.cellHeightMm}
          min={0.1}
          max={undefined}
          step={0.1}
          onChange={props.setField('cellHeightMm')}
        />
        <CalibrationNumberField
          label="Gap"
          value={props.draft.gapMm}
          min={0}
          max={undefined}
          step={0.1}
          onChange={props.setField('gapMm')}
        />
      </div>
      <label style={checkStyle}>
        <input
          type="checkbox"
          className="lf-checkbox"
          aria-label="Burn value labels"
          title="Burn each row's and column's value beside the grid."
          checked={props.draft.labels !== 'off'}
          onChange={(event) => props.onToggle('labels', event.target.checked)}
        />
        <span>Burn value labels</span>
      </label>
      <label style={checkStyle}>
        <input
          type="checkbox"
          className="lf-checkbox"
          aria-label="Border around the test"
          title="Burn a rectangle around the whole test, as its own operation."
          checked={props.draft.border === 'on'}
          onChange={(event) => props.onToggle('border', event.target.checked)}
        />
        <span>Border around the test</span>
      </label>
    </fieldset>
  );
}

export function MaterialTestPlacementField(props: {
  readonly placement: string;
  readonly onChange: (placement: 'insert' | 'new-project') => void;
}): JSX.Element {
  const newProject = props.placement === 'new-project';
  return (
    <fieldset style={fieldsetStyle}>
      <legend style={legendStyle}>Place the test</legend>
      <label style={checkStyle}>
        <input
          type="radio"
          name="material-test-placement"
          value="insert"
          title="Add the test to the open design, in free bed space."
          checked={!newProject}
          onChange={() => props.onChange('insert')}
        />
        <span>Add to the current design</span>
      </label>
      <label style={checkStyle}>
        <input
          type="radio"
          name="material-test-placement"
          value="new-project"
          title="Start a new project that holds only the test."
          checked={newProject}
          onChange={() => props.onChange('new-project')}
        />
        <span>Open as a new project</span>
      </label>
      <span style={hintStyle}>
        {newProject
          ? 'You can save unsaved changes before the new project opens.'
          : 'The test lands in free bed space, grouped and selected. Your artwork does not change.'}
      </span>
    </fieldset>
  );
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  fontSize: 12,
};
const hintStyle: CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
const axisGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.4fr) repeat(3, minmax(0, 1fr))',
  gap: 8,
  alignItems: 'end',
  marginTop: 8,
};
const threeColumnStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 8,
};
const fieldsetStyle: CSSProperties = {
  border: '1px solid var(--lf-border)',
  borderRadius: 4,
  margin: '10px 0 0',
  padding: '6px 8px 8px',
};
const legendStyle: CSSProperties = { fontSize: 12, padding: '0 4px' };
const checkStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  marginTop: 6,
};
