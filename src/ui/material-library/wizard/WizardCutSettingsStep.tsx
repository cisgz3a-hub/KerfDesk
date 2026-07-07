// Step 2 — the common cut settings shared by every mode. Uncontrolled inputs
// (read from FormData on Next) mirror the layer Cut Settings dialog, but omit
// the layer-session fields (visible / output) that must never live in a reusable
// preset.

import type { MaterialRecipe } from '../../../core/material-library';
import { Field, NumberInput } from '../../kit';

export function WizardCutSettingsStep(props: { readonly recipe: MaterialRecipe }): JSX.Element {
  const recipe = props.recipe;
  return (
    <div style={stepStyle}>
      <Field label="Mode">
        <select
          name="mode"
          className="lf-select"
          defaultValue={recipe.mode}
          aria-label="Preset mode"
          title="Line cuts outlines, Fill hatch-fills closed shapes, Image raster-engraves a bitmap."
        >
          <option value="line">Line</option>
          <option value="fill">Fill</option>
          <option value="image">Image</option>
        </select>
      </Field>
      <Field label="Power" unit="%">
        <NumberInput
          name="power"
          defaultValue={recipe.power}
          min={0}
          max={100}
          aria-label="Power"
        />
      </Field>
      <Field label="Speed" unit="mm/min">
        <NumberInput name="speed" defaultValue={recipe.speed} min={1} aria-label="Speed" />
      </Field>
      <Field label="Passes">
        <NumberInput
          name="passes"
          defaultValue={recipe.passes}
          min={1}
          step={1}
          aria-label="Passes"
        />
      </Field>
      <Field label="Recipe air">
        <input
          name="airAssist"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={recipe.airAssist === true}
          aria-label="Recipe uses air assist"
          title="Store air-assist intent in this material preset. Applying the preset turns on Job Air for the layer."
        />
      </Field>
    </div>
  );
}

const stepStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
