import {
  captureMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
} from '../../core/material-library';
import type { Layer } from '../../core/scene';
import type { MaterialExperiment } from '../../core/material-library/material-experiment';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';
import {
  materialBindingStatus,
  materialBindingStatusText,
} from '../layers/material-binding-status';

export function materialRecipeDifferences(
  layer: Layer,
  preset: MaterialPreset,
): ReadonlyArray<{ readonly setting: string; readonly before: string; readonly after: string }> {
  const before = captureMaterialRecipe(layer);
  const after = materialRecipePatch(preset.recipe);
  return MATERIAL_RECIPE_FIELDS.flatMap((key) =>
    before[key] === after[key]
      ? []
      : [
          {
            setting: SETTING_LABELS[key] ?? key,
            before: display(before[key]),
            after: display(after[key]),
          },
        ],
  );
}

export function MaterialRecipePreview(props: {
  readonly library: MaterialLibraryDocument;
  readonly preset: MaterialPreset | null;
  readonly layer: Layer | null;
}): JSX.Element | null {
  const preset = props.preset;
  if (preset === null) return null;
  const experiment = props.library.experiments?.find((record) =>
    record.cells.some(
      (cell) => cell.recipeRef?.id === preset.id && cell.recipeRef.kind === 'material',
    ),
  );
  const changes = props.layer === null ? [] : materialRecipeDifferences(props.layer, preset);
  return (
    <section aria-label="Selected material recipe preview">
      <h3>
        {preset.materialName} ·{' '}
        {preset.thicknessMm === undefined ? preset.title : `${preset.thicknessMm} mm`}
      </h3>
      <p>
        Revision {preset.revision} · {preset.confidence ?? 'Qualification not recorded'} ·{' '}
        {preset.laserModel ?? preset.profileId ?? 'Machine not specified'}
      </p>
      <p>{preset.description}</p>
      {preset.calibrationProvenance === undefined ? null : <p>{preset.calibrationProvenance}</p>}
      {preset.warning === undefined ? null : <p>{preset.warning}</p>}
      <ExperimentResultPreview experiment={experiment} />
      <p>
        {preset.recipe.mode} · {Number(preset.recipe.speed.toFixed(2))} mm/min ·{' '}
        {preset.recipe.power}% power · {preset.recipe.passes} passes
      </p>
      {props.layer === null ? null : (
        <details>
          <summary title="Compare current operation defaults with the selected recipe before applying or linking it; artwork overrides remain in place.">
            {changes.length} operation-default setting changes
          </summary>
          <p>
            Apply/Link changes this operation's recipe defaults. Existing artwork overrides remain
            in place.
          </p>
          <RecipeDifferenceTable changes={changes} />
        </details>
      )}
    </section>
  );
}

export function LinkedRecipeChangeReview(props: {
  readonly library: MaterialLibraryDocument;
  readonly layers: ReadonlyArray<Layer>;
}): JSX.Element {
  const linked = props.layers.filter((layer) => layer.materialBinding !== undefined);
  return (
    <details>
      <summary title="Inspect linked recipe revision status and setting differences before deciding whether to refresh an operation.">
        Review linked recipe revisions ({linked.length})
      </summary>
      {linked.length === 0 ? (
        <p>Operation defaults are manual until a preset is linked.</p>
      ) : (
        linked.map((layer) => {
          const binding = layer.materialBinding;
          if (binding === undefined) return null;
          const status = materialBindingStatus(binding, props.library);
          if (status === null) return null;
          return (
            <section key={layer.id} aria-label={`Recipe revision for ${layer.name}`}>
              <strong>{layer.name}</strong>
              <p>{materialBindingStatusText(binding, status)}</p>
              {status.entry === null ? (
                <p>Saved settings remain available. Restore the source before refreshing.</p>
              ) : (
                <RecipeDifferenceTable changes={materialRecipeDifferences(layer, status.entry)} />
              )}
            </section>
          );
        })
      )}
    </details>
  );
}

function ExperimentResultPreview(props: {
  readonly experiment: MaterialExperiment | undefined;
}): JSX.Element | null {
  const experiment = props.experiment;
  if (experiment?.photo === undefined) return null;
  return (
    <figure>
      <img
        src={experiment.photo.dataUrl}
        alt={`Observed result from ${experiment.name}`}
        style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }}
      />
      <figcaption>
        {experiment.name} · {experiment.batch || 'Batch not recorded'} · manually observed result
      </figcaption>
    </figure>
  );
}

function RecipeDifferenceTable(props: {
  readonly changes: ReturnType<typeof materialRecipeDifferences>;
}): JSX.Element {
  return props.changes.length === 0 ? (
    <p>Recipe defaults already match.</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Setting</th>
          <th>Current</th>
          <th>Recipe</th>
        </tr>
      </thead>
      <tbody>
        {props.changes.map((row) => (
          <tr key={row.setting}>
            <th scope="row">{row.setting}</th>
            <td>{row.before}</td>
            <td>{row.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
function display(value: unknown): string {
  return value === undefined
    ? 'Auto / inherited'
    : typeof value === 'boolean'
      ? value
        ? 'On'
        : 'Off'
      : String(value);
}
const SETTING_LABELS: Readonly<Record<string, string>> = {
  speed: 'Feed (mm/min)',
  power: 'Maximum power (%)',
  minPower: 'Minimum power (%)',
  mode: 'Process',
  passes: 'Passes',
  hatchSpacingMm: 'Hatch spacing (mm)',
  hatchAngleDeg: 'Hatch angle (°)',
  fillOverscanMm: 'Fill overscan (mm)',
  kerfOffsetMm: 'Kerf offset (mm)',
  linesPerMm: 'Image lines/mm',
  bidirectionalScanOffsetMm: 'Scan offset (mm)',
  powerMode: 'Power mode',
};
