// The undo stack's push and depth cap. Moved out of scene-mutations.ts, which
// re-exports both, so the 160-odd actions that import them from there are
// unchanged.

import type { Project } from '../../core/scene';
import { recordUndoStepName } from './undo-step-names';

// Shared undo/redo stack ceiling. store-actions caps the redo stack against the
// same value, so it lives beside pushUndo rather than being redeclared —
// keeping the two ceilings from silently desyncing.
export const HISTORY_DEPTH = 50;
// Source documents are immutable and shared across ordinary edits. Count each
// retained document once, conservatively charging two bytes per Base64 character.
// Always retain the newest step, even when one supported document exceeds this
// budget, so applying a large photo still has an immediate Undo.
export const HISTORY_SOURCE_BYTES = 256 * 1024 * 1024;

export function limitProjectHistory(
  stack: ReadonlyArray<Project>,
  byteBudget = HISTORY_SOURCE_BYTES,
): ReadonlyArray<Project> {
  const retained = stack.slice(-HISTORY_DEPTH);
  const sources = new Set<object>();
  let bytes = 0;
  for (let index = retained.length - 1; index >= 0; index--) {
    const project = retained[index];
    if (project === undefined) continue;
    let addedBytes = 0;
    for (const [source, size] of projectSources(project)) {
      if (sources.has(source)) continue;
      sources.add(source);
      addedBytes += size;
    }
    bytes += addedBytes;
    if (bytes > byteBudget && addedBytes > 0 && index < retained.length - 1)
      return retained.slice(index + 1);
  }
  return retained;
}

function projectSources(project: Project): ReadonlyArray<readonly [object, number]> {
  const sources: Array<readonly [object, number]> = [];
  for (const object of project.scene.objects) {
    if (object.kind !== 'raster-image' || object.editorDocument === undefined) continue;
    const document = object.editorDocument;
    sources.push([
      document,
      document.layers.reduce((bytes, layer) => bytes + layer.rgbaBase64.length * 2, 0),
    ]);
  }
  for (const document of project.studioDocuments ?? [])
    sources.push([document, document.nativeBase64.length * 2]);
  for (const sheet of project.sheetBook?.inactive ?? [])
    sources.push([sheet, sheet.projectJson.length * 2]);
  return sources;
}

// Push the previous project onto undoStack with a depth cap. `name` labels the
// step in the Undo list; without one the step takes the name of the command
// that ran it, or of what it changed (undo-step-names.ts).
export function pushUndo(
  prev: Project,
  stack: ReadonlyArray<Project>,
  name?: string,
): ReadonlyArray<Project> {
  recordUndoStepName(prev, name);
  return limitProjectHistory([...stack, prev]);
}
