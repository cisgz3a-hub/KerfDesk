import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import { Button } from '../kit';
import {
  buttonRowStyle,
  fieldStyle,
  headingStyle,
  hintStyle,
  labelStyle,
  statusStyle,
} from '../layers/material-library-panel-styles';
import { useProcessRecipeControls } from './use-process-recipe-controls';

export function ProcessRecipePanel(): JSX.Element {
  const model = useProcessRecipeControls();
  return (
    <section aria-label="Process recipes">
      <h3 style={headingStyle}>Process recipes</h3>
      <p style={hintStyle}>
        Save one artwork’s ordered operations, including disabled steps. Apply replaces the selected
        artwork’s operations with independent, editable copies.
      </p>
      <label style={fieldStyle}>
        <span style={labelStyle}>Name</span>
        <input
          aria-label="Process recipe name"
          title="Name the complete operation sequence saved from one selected artwork."
          value={model.name}
          onChange={(event) => model.setName(event.currentTarget.value)}
        />
      </label>
      <Button
        disabled={model.count !== 1 || model.name.trim() === ''}
        title="Save the selected artwork's complete operation sequence for reuse."
        onClick={model.save}
      >
        Save selected process
      </Button>
      <RecipePicker recipes={model.recipes} recipe={model.recipe} onChange={model.select} />
      {model.recipe === undefined ? null : <RecipeSummary recipe={model.recipe} />}
      <div style={buttonRowStyle}>
        <Button
          disabled={model.recipe === undefined || model.count === 0}
          title="Replace only selected artwork operations. Undo restores the previous process."
          onClick={model.apply}
        >
          Apply recipe to selection
        </Button>
        <Button
          disabled={model.recipe === undefined}
          title="Remove the selected recipe from this material library."
          onClick={model.remove}
        >
          Delete recipe
        </Button>
      </div>
      {model.count !== 1 ? (
        <p style={hintStyle}>
          Select one artwork to save a process. Select one or more to apply a saved recipe.
        </p>
      ) : null}
      {model.kind === 'cnc' ? (
        <p style={hintStyle}>
          Cutter definitions travel with the recipe. Stock, origin, clearance and machine limits
          stay with this project; review them before Frame. CNC keeps its normal tool and clearing
          order.
        </p>
      ) : null}
      {model.status === '' ? null : (
        <p role="status" style={statusStyle}>
          {model.status}
        </p>
      )}
    </section>
  );
}

function RecipePicker(props: {
  readonly recipes: ReadonlyArray<ProcessRecipe>;
  readonly recipe: ProcessRecipe | undefined;
  readonly onChange: (id: string) => void;
}): JSX.Element {
  return (
    <label style={fieldStyle}>
      <span style={labelStyle}>Recipe</span>
      <select
        aria-label="Saved process recipe"
        title="Choose a saved process recipe for this machine type."
        value={props.recipe?.id ?? ''}
        disabled={props.recipes.length === 0}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      >
        {props.recipes.length === 0 ? (
          <option value="">No process recipes</option>
        ) : (
          props.recipes.map((recipe) => (
            <option key={recipe.id} value={recipe.id}>
              {recipe.name}
            </option>
          ))
        )}
      </select>
    </label>
  );
}

function RecipeSummary({ recipe }: { readonly recipe: ProcessRecipe }): JSX.Element {
  return (
    <>
      <ol aria-label="Recipe operation order" style={hintStyle}>
        {recipe.steps.map((step, index) => (
          <li key={index}>
            {step.name}:{' '}
            {recipe.machineKind === 'cnc'
              ? `${step.cnc?.cutType}, ${step.cnc?.feedMmPerMin} mm/min, ${step.cnc?.depthMm} mm deep`
              : `${step.settings.mode}, ${step.settings.power}%, ${step.settings.speed} mm/min, ${step.settings.passes} pass${step.settings.passes === 1 ? '' : 'es'}`}
            {step.output ? '' : ' (disabled)'}
            {step.visible ? '' : ' (hidden)'}
          </li>
        ))}
      </ol>
      {recipe.pathSteps === undefined ? null : (
        <p style={hintStyle}>
          Uses {recipe.pathSteps.length} individually assigned paths, in source path order.
        </p>
      )}
    </>
  );
}
