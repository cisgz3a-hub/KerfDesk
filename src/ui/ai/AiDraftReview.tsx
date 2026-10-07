import type { AiDraft, AiRequest } from '../../core/ai/assistant';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { MaterialRecipePreview } from '../material-library/MaterialRecipePreview';
import { suggestedProcess } from './ai-candidates';

export function AiDraftReview(props: {
  readonly draft: AiDraft;
  readonly request: AiRequest;
  readonly library: MaterialLibraryDocument | null;
}): JSX.Element {
  return (
    <section aria-label="AI draft review">
      <h3>{props.draft.title}</h3>
      <p>{props.draft.explanation}</p>
      {props.request.task === 'vector' ? (
        <VectorPreview draft={props.draft} request={props.request} />
      ) : (
        <>
          <p>
            Visual similarity is a suggestion. It does not establish material composition,
            suitability or proven machine settings.
          </p>
          {props.draft.matches.length === 0 ? <p>No saved recipes matched this request.</p> : null}
          <ol>
            {props.draft.matches.map((match) => (
              <li key={match.id}>
                <p>
                  {props.request.candidates.find((candidate) => candidate.id === match.id)?.name} ·{' '}
                  {match.reason}
                </p>
                <RecipeReview id={match.id} library={props.library} />
              </li>
            ))}
          </ol>
          <p>Use the material library to apply a reviewed recipe to your chosen operation.</p>
        </>
      )}
    </section>
  );
}
function VectorPreview({
  draft,
  request,
}: {
  readonly draft: AiDraft;
  readonly request: AiRequest;
}): JSX.Element {
  return (
    <>
      <svg
        aria-label="Generated vector preview"
        role="img"
        viewBox={`0 0 ${request.widthMm} ${request.heightMm}`}
        width="100%"
        height="260"
        style={{ background: 'var(--lf-surface)', border: '1px solid var(--lf-border)' }}
      >
        {draft.paths.map((path, index) =>
          path.closed ? (
            <polygon
              key={index}
              points={path.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polyline
              key={index}
              points={path.points.map((point) => `${point.x},${point.y}`).join(' ')}
              fill="none"
              stroke="currentColor"
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
      </svg>
      <p>
        {request.widthMm} × {request.heightMm} mm · {draft.paths.length} paths ·{' '}
        {draft.paths.reduce((sum, path) => sum + path.points.length, 0)} editable points. Review
        dimensions and contours before manufacturing.
      </p>
    </>
  );
}
function RecipeReview({
  id,
  library,
}: {
  readonly id: string;
  readonly library: MaterialLibraryDocument | null;
}): JSX.Element | null {
  if (library === null) return null;
  const preset = library.entries.find((entry) => `material:${entry.id}` === id);
  if (preset !== undefined)
    return <MaterialRecipePreview library={library} preset={preset} layer={null} />;
  const recipe = suggestedProcess(library, id);
  return recipe === undefined ? null : (
    <details>
      <summary title="Inspect this saved process revision. AI does not generate or apply machine settings.">
        {recipe.name} · saved revision {recipe.revision}
      </summary>
      <p>{recipe.description}</p>
      <ol>
        {recipe.steps.map((step, index) => (
          <li key={index}>
            {step.name} · {step.settings.mode} ·{' '}
            {step.output ? 'output enabled' : 'output disabled'}
          </li>
        ))}
      </ol>
    </details>
  );
}
