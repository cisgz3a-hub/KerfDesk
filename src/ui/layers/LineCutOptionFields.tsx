// Cut Settings fields for the ADR-385 Line options. Uncontrolled like the rest
// of the dialog: Apply reads the form, and cut-settings-line-options.ts only
// writes a value the operator actually changed.

import { useState } from 'react';
import {
  DEFAULT_TAB_MAX_PER_SHAPE,
  DEFAULT_TAB_MIN_PER_SHAPE,
  DEFAULT_TAB_SPACING_MM,
} from '../../core/geometry/tab-spacing';
import { MAX_LINE_OVERCUT_MM } from '../../core/job/line-overcut';
import type { Layer } from '../../core/scene';
import type { TabPlacement } from '../../core/scene/layer';
import {
  MAX_TAB_COUNT_PER_SHAPE,
  MAX_TAB_SPACING_MM,
  MIN_TAB_SPACING_MM,
} from './cut-settings-line-options';

export function LineOvercutField(props: { readonly layer: Layer }): JSX.Element {
  return (
    <Field label="Overcut">
      <NumberInput
        name="overcutMm"
        value={props.layer.overcutMm ?? 0}
        min={0}
        max={MAX_LINE_OVERCUT_MM}
        step={0.1}
        label="overcut"
        title="Keep cutting this far past the start of each closed shape, on the final pass only, so the start and finish fully join. Shapes split by tabs are not overcut. 0 turns it off."
      />
      <span className="lf-field-unit">mm</span>
    </Field>
  );
}

export function LineTabPlacementFields(props: { readonly layer: Layer }): JSX.Element {
  const [placement, setPlacement] = useState<TabPlacement>(props.layer.tabPlacement ?? 'per-shape');
  return (
    <>
      <Field label="Placement">
        <select
          name="tabPlacement"
          className="lf-select"
          value={placement}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'per-shape' || value === 'spacing') setPlacement(value);
          }}
          aria-label="Cut settings tab placement"
          title="Choose a fixed tab count for every shape, or one tab every set distance along each shape."
        >
          <option value="per-shape">Count per shape</option>
          <option value="spacing">Every set distance</option>
        </select>
      </Field>
      {placement === 'spacing' ? <TabSpacingFields layer={props.layer} /> : null}
    </>
  );
}

function TabSpacingFields(props: { readonly layer: Layer }): JSX.Element {
  return (
    <>
      <Field label="Spacing">
        <NumberInput
          name="tabSpacingMm"
          value={props.layer.tabSpacingMm ?? DEFAULT_TAB_SPACING_MM}
          min={MIN_TAB_SPACING_MM}
          max={MAX_TAB_SPACING_MM}
          step={1}
          label="tab spacing"
          title="Longest run of cut between tabs. Each shape gets the fewest evenly spread tabs that keep every run this short or shorter."
        />
        <span className="lf-field-unit">mm</span>
      </Field>
      <Field label="Min per shape">
        <NumberInput
          name="tabMinPerShape"
          value={props.layer.tabMinPerShape ?? DEFAULT_TAB_MIN_PER_SHAPE}
          min={1}
          max={MAX_TAB_COUNT_PER_SHAPE}
          label="minimum tabs per shape"
          title="Fewest tabs any shape gets, however small it is."
        />
      </Field>
      <Field label="Max per shape">
        <NumberInput
          name="tabMaxPerShape"
          value={props.layer.tabMaxPerShape ?? DEFAULT_TAB_MAX_PER_SHAPE}
          min={1}
          max={MAX_TAB_COUNT_PER_SHAPE}
          label="maximum tabs per shape"
          title="Most tabs any shape gets, however long it is. If it is below the minimum, the minimum wins."
        />
      </Field>
    </>
  );
}

function NumberInput(props: {
  readonly name: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly label: string;
  readonly title: string;
}): JSX.Element {
  return (
    <input
      name={props.name}
      type="number"
      className="lf-input"
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      defaultValue={props.value}
      style={numberStyle}
      aria-label={`Cut settings ${props.label}`}
      title={props.title}
    />
  );
}

function Field(props: { readonly label: string; readonly children: React.ReactNode }): JSX.Element {
  return (
    <label className="lf-field">
      <span className="lf-field-label lf-field-label--md">{props.label}</span>
      <span style={controlStyle}>{props.children}</span>
    </label>
  );
}

const controlStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};
const numberStyle: React.CSSProperties = { width: 96 };
