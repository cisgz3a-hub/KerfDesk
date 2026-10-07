import type { MaterialExperiment } from '../../core/material-library/material-experiment';
import { Button } from '../kit';

export type ExperimentFieldsProps = {
  readonly draft: MaterialExperiment;
  readonly onChange: (draft: MaterialExperiment) => void;
};

export function MaterialExperimentFields({ draft, onChange }: ExperimentFieldsProps): JSX.Element {
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        <label>
          Experiment name
          <input
            aria-label="Experiment name"
            title="Name this captured test so its settings, observations and result photo can be found later."
            maxLength={200}
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.currentTarget.value })}
          />
        </label>
        <label>
          Material
          <input
            aria-label="Experiment material"
            title="Record the actual material tested; the name does not establish compatibility with other stock."
            maxLength={200}
            value={draft.material}
            onChange={(event) => onChange({ ...draft, material: event.currentTarget.value })}
          />
        </label>
        <label>
          Supplier / batch
          <input
            aria-label="Material batch"
            title="Record the supplier or stock batch to distinguish observations from another material lot."
            maxLength={200}
            value={draft.batch}
            onChange={(event) => onChange({ ...draft, batch: event.currentTarget.value })}
          />
        </label>
        <label>
          Measured thickness (mm)
          <input
            aria-label="Experiment thickness"
            title="Enter independently measured stock thickness in millimetres, or leave it blank if unmeasured."
            type="number"
            min={0.001}
            step="any"
            value={draft.thicknessMm ?? ''}
            onChange={(event) => {
              const { thicknessMm: _thickness, ...rest } = draft;
              const value = Number(event.currentTarget.value);
              onChange(event.currentTarget.value === '' ? rest : { ...rest, thicknessMm: value });
            }}
          />
        </label>
      </div>
      <label>
        Experiment notes
        <textarea
          aria-label="Experiment notes"
          title="Record test conditions, measurement method and overall observations alongside the captured settings."
          maxLength={10_000}
          value={draft.notes}
          onChange={(event) => onChange({ ...draft, notes: event.currentTarget.value })}
        />
      </label>
    </>
  );
}

export function ExperimentCellEditor(
  props: ExperimentFieldsProps & {
    readonly recipeName: string;
    readonly onRecipeName: (name: string) => void;
    readonly onSaveRecipe: () => void;
  },
): JSX.Element {
  const { draft, onChange } = props;
  const cell = draft.cells.find((entry) => entry.id === draft.selectedCellId);
  return (
    <>
      <label>
        Inspect cell
        <select
          aria-label="Experiment cell"
          title="Choose a grid row and column to inspect its captured process settings and record a cell observation."
          value={draft.selectedCellId ?? ''}
          onChange={(event) => onChange({ ...draft, selectedCellId: event.currentTarget.value })}
        >
          <option value="" disabled>
            Choose a cell
          </option>
          {draft.cells.map((entry) => (
            <option key={entry.id} value={entry.id}>
              Row {entry.row + 1}, column {entry.column + 1}
            </option>
          ))}
        </select>
      </label>
      {cell === undefined ? null : (
        <section aria-label="Captured cell settings">
          <p>
            Requested {Number(cell.requestedFeed.toFixed(2))} mm/min ·{' '}
            {draft.source === 'grid' ? 'effective grid' : 'captured process'} feed{' '}
            {Number(cell.effectiveFeed.toFixed(2))} mm/min
          </p>
          <ExperimentStepSummary process={cell.process} />
          <label>
            Cell observation
            <textarea
              aria-label="Cell observation"
              title="Describe the independently observed result for this cell, including defects or uncertainty."
              maxLength={10_000}
              value={cell.observation}
              onChange={(event) =>
                onChange({
                  ...draft,
                  cells: draft.cells.map((entry) =>
                    entry.id === cell.id
                      ? { ...entry, observation: event.currentTarget.value }
                      : entry,
                  ),
                })
              }
            />
          </label>
          <label>
            Recipe name
            <input
              aria-label="Experiment recipe name"
              title="Name the reusable recipe to create from this selected cell's captured process settings."
              maxLength={200}
              value={props.recipeName}
              onChange={(event) => props.onRecipeName(event.currentTarget.value)}
            />
          </label>
          <Button disabled={props.recipeName.trim() === ''} onClick={props.onSaveRecipe}>
            Save selected cell as recipe
          </Button>
          {cell.recipeRef === undefined ? null : (
            <p>
              Saved {cell.recipeRef.kind} recipe {cell.recipeRef.id} · revision{' '}
              {cell.recipeRef.revision}
            </p>
          )}
        </section>
      )}
    </>
  );
}

function ExperimentStepSummary(props: {
  readonly process: MaterialExperiment['cells'][number]['process'];
}): JSX.Element {
  return (
    <ul>
      {props.process.steps.map((step, index) => (
        <li key={index}>
          {step.name}:{' '}
          {step.cnc === undefined
            ? `${step.settings.mode}, ${step.settings.power}% power, ${step.settings.passes} passes, ${step.settings.hatchSpacingMm} mm spacing`
            : `${step.cnc.cutType}, ${step.cnc.feedMmPerMin} mm/min, depth ${step.cnc.depthMm} mm, tool ${step.cnc.toolId ?? 'default'}`}
        </li>
      ))}
    </ul>
  );
}
