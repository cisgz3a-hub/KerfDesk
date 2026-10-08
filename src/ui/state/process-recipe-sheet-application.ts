import type {
  ProcessRecipe,
  ProcessRecipeResult,
} from '../../core/material-library/process-recipe';
import {
  applyProcessRecipeTemplate,
  findRecipeApplication,
} from '../../core/material-library/apply-process-recipe-template';
import {
  previewProcessRecipe,
  type ProcessRecipePreview,
} from '../../core/material-library/process-recipe-selectors';
import type { Project } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';

export type ProcessRecipeSheetPreview = {
  readonly sheets: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly preview: ProcessRecipePreview;
  }>;
  readonly signature: string;
};

export function previewProcessRecipeSheets(
  project: Project,
  sheetIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
): ProcessRecipeResult<ProcessRecipeSheetPreview> {
  const sheets = readTemplateSheets(project, sheetIds);
  if (sheets.kind === 'invalid') return sheets;
  const previews = sheets.value.map((sheet) => {
    const ids = sheet.project.scene.objects.map((object) => object.id);
    return {
      id: sheet.id,
      name: sheet.name,
      preview: previewProcessRecipe(
        sheet.project,
        ids,
        recipe,
        findRecipeApplication(sheet.project, ids, recipe.id),
      ),
    };
  });
  return {
    kind: 'ok',
    value: {
      sheets: previews,
      signature: JSON.stringify(previews.map((sheet) => [sheet.id, sheet.preview.signature])),
    },
  };
}

/** All selected sheets update atomically, leaving sheets without any matched roles untouched. */
export function applyProcessRecipeSheets(
  project: Project,
  sheetIds: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  signature: string,
): ProcessRecipeResult<{ readonly project: Project; readonly artworkCount: number }> {
  const reviewed = previewProcessRecipeSheets(project, sheetIds, recipe);
  if (reviewed.kind === 'invalid') return reviewed;
  if (reviewed.value.signature !== signature)
    return invalid('A sheet, recipe or cutter changed. Review the sheet matches again.');
  const sheets = readTemplateSheets(project, sheetIds);
  if (sheets.kind === 'invalid') return sheets;
  const updated = new Map<string, Project>();
  let artworkCount = 0;
  for (const sheet of sheets.value) {
    const preview = reviewed.value.sheets.find((entry) => entry.id === sheet.id)?.preview;
    if (preview === undefined || preview.matchedObjectIds.length === 0) continue;
    const applied = applyProcessRecipeTemplate(
      sheet.project,
      sheet.project.scene.objects.map((object) => object.id),
      recipe,
      { reviewedSignature: preview.signature },
    );
    if (applied.kind === 'invalid') return invalid(sheet.name + ': ' + applied.reason);
    if (applied.value.scene.layers.length > 256)
      return invalid(sheet.name + ': template would exceed 256 operations.');
    updated.set(sheet.id, applied.value);
    artworkCount += preview.matchedObjectIds.length;
  }
  if (artworkCount === 0) return invalid('No roles match the selected sheets.');
  return { kind: 'ok', value: { project: updatedSheetProject(project, updated), artworkCount } };
}

type TemplateSheet = { readonly id: string; readonly name: string; readonly project: Project };
function readTemplateSheets(
  project: Project,
  sheetIds: ReadonlyArray<string>,
): ProcessRecipeResult<ReadonlyArray<TemplateSheet>> {
  const book = project.sheetBook;
  const selected = new Set(sheetIds);
  const result: TemplateSheet[] = [];
  const active = activeTemplateSheet(project);
  if (selected.has(active.id)) result.push(active);
  for (const sheet of book?.inactive ?? []) {
    if (!selected.has(sheet.id)) continue;
    const parsed = deserializeProject(sheet.projectJson);
    if (parsed.kind !== 'ok') return invalid('Cannot reopen sheet ' + sheet.name + '.');
    result.push({ id: sheet.id, name: sheet.name, project: parsed.project });
  }
  return result.length === selected.size && result.length > 0
    ? { kind: 'ok', value: result }
    : invalid('Choose existing sheets to review.');
}
function invalid(reason: string): { readonly kind: 'invalid'; readonly reason: string } {
  return { kind: 'invalid', reason };
}

function updatedSheetProject(project: Project, updated: ReadonlyMap<string, Project>): Project {
  const book = project.sheetBook;
  if (book === undefined) return updated.get('active') ?? project;
  const active = updated.get(book.activeId) ?? project;
  return {
    ...active,
    sheetBook: {
      ...book,
      inactive: book.inactive.map((sheet) => {
        const value = updated.get(sheet.id);
        return value === undefined
          ? sheet
          : { ...sheet, projectJson: serializeProject(value, { compact: true }) };
      }),
    },
  };
}

function activeTemplateSheet(project: Project): TemplateSheet {
  return {
    id: project.sheetBook?.activeId ?? 'active',
    name: project.sheetBook?.activeName ?? 'Current sheet',
    project,
  };
}
