import type { Project } from '../../core/scene';
import type { AppState } from './store';

type Selection = Pick<AppState, 'selectedObjectId' | 'additionalSelectedIds'>;
type Entry = { readonly partId: string; readonly hasPart: boolean; readonly selection: Selection };
const contexts = new WeakMap<Project, Entry>();

export function captureTracePartHistory(
  project: Project,
  partId: string,
  selection: Selection,
): void {
  contexts.set(project, { partId, hasPart: false, selection: copySelection(selection) });
}

/** Only an extraction transition restores a selection, including its reciprocal Redo. */
export function tracePartHistorySelection(
  state: Selection & { readonly project: Project },
  restored: Project,
): Selection | null {
  const entry = contexts.get(restored);
  if (entry === undefined) return null;
  const hasPart = state.project.scene.objects.some((object) => object.id === entry.partId);
  if (hasPart === entry.hasPart) return null;
  contexts.set(state.project, { partId: entry.partId, hasPart, selection: copySelection(state) });
  return copySelection(entry.selection);
}

function copySelection(selection: Selection): Selection {
  return {
    selectedObjectId: selection.selectedObjectId,
    additionalSelectedIds: new Set(selection.additionalSelectedIds),
  };
}
