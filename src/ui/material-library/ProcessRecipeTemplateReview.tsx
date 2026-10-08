import type { ProcessRecipe } from '../../core/material-library/process-recipe';
import { Button } from '../kit';
import { RecipeMatchPreview } from './RecipeMatchPreview';
import { TemplateVectorRepair } from './TemplateVectorRepair';
import {
  useMachiningTemplateReview,
  type TemplateTargetScope,
} from './use-machining-template-review';
import { hintStyle } from '../layers/material-library-panel-styles';

export function ProcessRecipeTemplateReview({
  recipe,
}: {
  readonly recipe: ProcessRecipe;
}): JSX.Element {
  const model = useMachiningTemplateReview(recipe);
  return (
    <section aria-label="Review machining template">
      <label>
        Template target{' '}
        <select
          title="Apply the template to selected artwork or selected production sheets"
          aria-label="Machining template target"
          value={model.scope}
          onChange={(event) => model.setScope(event.currentTarget.value as TemplateTargetScope)}
        >
          <option value="selection">Selected artwork / parts</option>
          <option value="sheets">Selected sheets</option>
        </select>
      </label>
      {model.scope === 'sheets' ? (
        <fieldset>
          <legend>Sheets to review</legend>
          {model.sheets.map((sheet) => (
            <label key={sheet.id}>
              <input
                title={'Include sheet ' + sheet.name + ' in this template application'}
                type="checkbox"
                checked={model.sheetIds.includes(sheet.id)}
                onChange={(event) => model.toggleSheet(sheet.id, event.currentTarget.checked)}
              />
              {sheet.name}
            </label>
          ))}
        </fieldset>
      ) : null}
      <Button disabled={!model.canReview} onClick={model.review}>
        Review template matches
      </Button>
      <Button disabled={!model.canApply} onClick={model.apply}>
        Apply machining template
      </Button>
      {model.reviewed === null
        ? null
        : model.reviewed.sheets.map((sheet) => (
            <RecipeMatchPreview key={sheet.id} name={sheet.name} preview={sheet.preview} />
          ))}
      {model.reviewed !== null && !model.current ? (
        <p style={hintStyle}>The artwork or recipe changed. Review the matches again.</p>
      ) : null}
      {model.scope === 'selection' ? <TemplateVectorRepair /> : null}
      {model.status === '' ? null : <p role="status">{model.status}</p>}
    </section>
  );
}
