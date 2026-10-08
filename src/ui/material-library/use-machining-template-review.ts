import { useState } from 'react';
import type { Project } from '../../core/scene';
import type {
  ProcessRecipe,
  ProcessRecipeResult,
} from '../../core/material-library/process-recipe';
import { findRecipeApplication } from '../../core/material-library/apply-process-recipe-template';
import { previewProcessRecipe } from '../../core/material-library/process-recipe-selectors';
import {
  previewProcessRecipeSheets,
  type ProcessRecipeSheetPreview,
} from '../state/process-recipe-sheet-application';
import { useStore } from '../state';
import { useEdition } from '../licensing/edition';
import { recipeProFeature } from './use-process-recipe-controls';

type Review = ProcessRecipeSheetPreview & {
  readonly project: Project;
  readonly recipe: ProcessRecipe;
  readonly key: string;
};
export type TemplateTargetScope = 'selection' | 'sheets';

export function useMachiningTemplateReview(recipe: ProcessRecipe): {
  readonly scope: TemplateTargetScope;
  readonly setScope: (value: TemplateTargetScope) => void;
  readonly sheets: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly sheetIds: ReadonlyArray<string>;
  readonly toggleSheet: (id: string, checked: boolean) => void;
  readonly reviewed: Review | null;
  readonly current: boolean;
  readonly canReview: boolean;
  readonly canApply: boolean;
  readonly review: () => void;
  readonly apply: () => void;
  readonly status: string;
} {
  const project = useStore((state) => state.project);
  const selected = useStore((state) => state.selectedObjectId);
  const additional = useStore((state) => state.additionalSelectedIds);
  const apply = useStore((state) => state.applyProcessRecipeToSelection);
  const applySheets = useStore((state) => state.applyProcessRecipeToSheets);
  const edition = useEdition();
  const ids = [...new Set([...(selected === null ? [] : [selected]), ...additional])];
  const sheets = templateTargetSheets(project);
  const [scope, setScope] = useState<TemplateTargetScope>('selection');
  const [chosen, setChosen] = useState<ReadonlyArray<string> | null>(null);
  const sheetIds = chosen ?? [sheets[0]?.id ?? 'active'];
  const [reviewed, setReviewed] = useState<Review | null>(null);
  const [status, setStatus] = useState('');
  const key = scope + ':' + [...(scope === 'selection' ? ids : sheetIds)].sort().join('|');
  const current = reviewIsCurrent(reviewed, project, recipe, key);
  const review = (): void => {
    const result = reviewTemplateTarget(project, recipe, scope, ids, sheetIds);
    if (result.kind === 'invalid') {
      setStatus(result.reason);
      setReviewed(null);
      return;
    }
    setReviewed({ project, recipe, key, ...result.value });
    setStatus('Review matched vectors, missing roles, cutter mappings and preserved edits below.');
  };
  const run = (): void => {
    if (!current || reviewed === null) return;
    const result =
      scope === 'selection'
        ? apply(recipe.id, reviewed.signature)
        : applySheets(recipe.id, sheetIds, reviewed.signature);
    setStatus(
      result.kind === 'invalid'
        ? result.reason
        : 'Applied ' +
            recipe.name +
            ' to ' +
            result.value +
            ' artworks. Reapply keeps operator edits.',
    );
    setReviewed(null);
  };
  const applyReviewed = (): void => {
    const feature = recipeProFeature(recipe);
    if (feature === null) run();
    else edition.requestPro(feature, run);
  };
  return {
    scope,
    setScope,
    sheets,
    sheetIds,
    reviewed,
    current,
    canReview: (scope === 'selection' ? ids : sheetIds).length > 0,
    canApply: current && reviewHasMatches(reviewed),
    review,
    apply: applyReviewed,
    status,
    toggleSheet: (id, checked) =>
      setChosen(checked ? [...sheetIds, id] : sheetIds.filter((value) => value !== id)),
  };
}
function reviewTemplateTarget(
  project: Project,
  recipe: ProcessRecipe,
  scope: TemplateTargetScope,
  ids: ReadonlyArray<string>,
  sheetIds: ReadonlyArray<string>,
): ProcessRecipeResult<ProcessRecipeSheetPreview> {
  if (scope === 'sheets') return previewProcessRecipeSheets(project, sheetIds, recipe);
  const preview = previewProcessRecipe(
    project,
    ids,
    recipe,
    findRecipeApplication(project, ids, recipe.id),
  );
  return {
    kind: 'ok',
    value: {
      signature: preview.signature,
      sheets: [
        {
          id: project.sheetBook?.activeId ?? 'active',
          name: project.sheetBook?.activeName ?? 'Current sheet',
          preview,
        },
      ],
    },
  };
}
function templateTargetSheets(
  project: Project,
): ReadonlyArray<{ readonly id: string; readonly name: string }> {
  return [
    {
      id: project.sheetBook?.activeId ?? 'active',
      name: project.sheetBook?.activeName ?? 'Current sheet',
    },
    ...(project.sheetBook?.inactive ?? []),
  ];
}
function reviewIsCurrent(
  reviewed: Review | null,
  project: Project,
  recipe: ProcessRecipe,
  key: string,
): boolean {
  return (
    reviewed !== null &&
    reviewed.project === project &&
    reviewed.recipe === recipe &&
    reviewed.key === key
  );
}
function reviewHasMatches(reviewed: Review | null): boolean {
  return (
    reviewed !== null && reviewed.sheets.some((sheet) => sheet.preview.matchedObjectIds.length > 0)
  );
}
