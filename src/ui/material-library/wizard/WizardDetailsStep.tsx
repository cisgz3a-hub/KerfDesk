// Step 3 — mode-specific details. Reuses the exact layer Fill/Image field
// components (so a preset gets the same interval/DPI/dither controls and
// clamping as a layer); Line details are a small local fieldset.

import { useState } from 'react';
import type { MaterialRecipe } from '../../../core/material-library';
import { assertNever } from '../../../core/scene';
import { Field, NumberInput } from '../../kit';
import { CutSettingsFillFields } from '../../layers/CutSettingsFillFields';
import { CutSettingsImageFields } from '../../layers/CutSettingsImageFields';
import { recipeToLayer } from './wizard-recipe';

export function WizardDetailsStep(props: { readonly recipe: MaterialRecipe }): JSX.Element {
  const recipe = props.recipe;
  const layer = recipeToLayer(recipe);
  const [fillIntervalMm, setFillIntervalMm] = useState(recipe.hatchSpacingMm);
  const [imageLinesPerMm, setImageLinesPerMm] = useState(recipe.linesPerMm);
  const [dither, setDither] = useState(recipe.ditherAlgorithm);
  switch (recipe.mode) {
    case 'line':
      return <LineDetailFields recipe={recipe} />;
    case 'fill':
      return (
        <CutSettingsFillFields
          layer={layer}
          lineIntervalMm={fillIntervalMm}
          onLineIntervalMmChange={setFillIntervalMm}
        />
      );
    case 'image':
      return (
        <CutSettingsImageFields
          layer={layer}
          dither={dither}
          imageLinesPerMm={imageLinesPerMm}
          onDitherChange={setDither}
          onImageLinesPerMmChange={setImageLinesPerMm}
        />
      );
    default:
      return assertNever(recipe.mode, 'preset mode');
  }
}

function LineDetailFields(props: { readonly recipe: MaterialRecipe }): JSX.Element {
  const recipe = props.recipe;
  return (
    <fieldset className="lf-fieldset">
      <legend className="lf-legend">Line</legend>
      <Field label="Kerf offset" unit="mm">
        <NumberInput
          name="kerfOffsetMm"
          defaultValue={recipe.kerfOffsetMm ?? 0}
          min={-10}
          max={10}
          step={0.01}
          aria-label="Kerf offset"
        />
      </Field>
      <Field label="Tabs / bridges">
        <input
          name="tabsEnabled"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={recipe.tabsEnabled === true}
          aria-label="Enable tabs"
          title="Leave small uncut bridges so parts stay attached until removed."
        />
      </Field>
      <Field label="Tab size" unit="mm">
        <NumberInput
          name="tabSizeMm"
          defaultValue={recipe.tabSizeMm ?? 0.5}
          min={0.01}
          max={100}
          step={0.01}
          aria-label="Tab size"
        />
      </Field>
      <Field label="Tab count">
        <NumberInput
          name="tabsPerShape"
          defaultValue={recipe.tabsPerShape ?? 4}
          min={1}
          max={100}
          step={1}
          aria-label="Tabs per shape"
        />
      </Field>
      <Field label="Skip holes">
        <input
          name="tabSkipInnerShapes"
          type="checkbox"
          className="lf-checkbox"
          defaultChecked={recipe.tabSkipInnerShapes !== false}
          aria-label="Skip inner shapes"
          title="Leave inner contours and holes whole instead of adding tabs to them."
        />
      </Field>
    </fieldset>
  );
}
