import { useState } from 'react';
import type { Project } from '../../core/scene';
import {
  previewProcessRecipe,
  type ProcessRecipePreview,
} from '../../core/material-library/process-recipe-selectors';
import { useStore } from '../state';
import { Button } from '../kit';
import { RecipeMatchPreview } from './RecipeMatchPreview';

export function RetainedProcessRecipeControls(): JSX.Element | null {
  const project = useStore((state) => state.project);
  const reapply = useStore((state) => state.reapplyProcessRecipeApplication);
  const [id, choose] = useState('');
  const [reviewed, setReviewed] = useState<{
    readonly project: Project;
    readonly id: string;
    readonly preview: ProcessRecipePreview;
  } | null>(null);
  const [status, setStatus] = useState('');
  const applications = project.processRecipeApplications ?? [];
  const application = applications.find((entry) => entry.id === id) ?? applications[0];
  if (application === undefined) return null;
  const current = retainedReviewCurrent(reviewed, project, application.id);
  const review = (): void =>
    setReviewed({
      project,
      id: application.id,
      preview: previewProcessRecipe(
        project,
        application.objectIds,
        application.recipe,
        application,
      ),
    });
  const run = (): void => {
    if (!current || reviewed === null) return;
    const result = reapply(application.id, reviewed.preview.signature);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : 'Reapplied ' +
            application.recipe.name +
            ' to ' +
            result.value +
            ' artworks, preserving operator edits.',
    );
    setReviewed(null);
  };
  return (
    <section aria-label="Retained machining templates">
      <h4>Applied templates</h4>
      <label>
        Application{' '}
        <select
          title="Choose the retained machining template application to inspect or edit"
          aria-label="Retained machining template"
          value={application.id}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          {applications.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.recipe.name} · revision {entry.recipe.revision} · {entry.objectIds.length}{' '}
              artworks
            </option>
          ))}
        </select>
      </label>
      <Button onClick={review}>Review retained template</Button>
      <Button disabled={!current || !retainedReviewHasMatches(reviewed)} onClick={run}>
        Reapply retained template
      </Button>
      {reviewed === null ? null : (
        <RecipeMatchPreview
          name={project.sheetBook?.activeName ?? 'Current sheet'}
          preview={reviewed.preview}
        />
      )}
      {reviewed !== null && !current ? (
        <p>The artwork changed. Review the retained template again.</p>
      ) : null}
      {status === '' ? null : <p role="status">{status}</p>}
    </section>
  );
}

function retainedReviewCurrent(
  reviewed: { readonly project: Project; readonly id: string } | null,
  project: Project,
  id: string,
): boolean {
  return reviewed !== null && reviewed.project === project && reviewed.id === id;
}
function retainedReviewHasMatches(
  reviewed: { readonly preview: ProcessRecipePreview } | null,
): boolean {
  return reviewed !== null && reviewed.preview.matchedObjectIds.length > 0;
}
