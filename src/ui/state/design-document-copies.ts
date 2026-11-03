// design-document-copies — which Design Studio documents a copy of the project
// on disk holds (ADR-590 Amendment 3).
//
// An Apply writes the Studio drawing into the project as a new document. Until
// a save, an open or an autosave writes or reads that project, the Studio's
// own saved drawing is the only copy of the Apply: a crash loses it from the
// workspace. The Studio records with its saved drawing whether a copy holds
// it, and keeps, offers and evicts from that fact instead of guessing from
// what the opened project shares with the drawing.
//
// Documents are compared by identity: only an Apply makes one, and every other
// edit carries the same object over, so a copy that holds the document holds
// the Apply. The set lives for this page; the saved drawing carries the answer
// past a restart.

import type { DesignStudioDocument } from '../../core/design/design-studio-document';
import type { Project } from '../../core/scene';

const held = new WeakSet<DesignStudioDocument>();
const listeners = new Set<() => void>();

/** Records that a file or autosave now holds `project` as it is: a save, an
 *  open, or an autosave write that succeeded. */
export function noteProjectCopyOnDisk(project: Project): void {
  const document = project.designStudioDocument;
  if (document === undefined || held.has(document)) return;
  held.add(document);
  for (const listener of listeners) listener();
}

/** Records that the file `project` was saved to may no longer hold it: a
 *  later write to it did not finish. The next autosave records it again. */
export function noteProjectCopyInDoubt(project: Project): void {
  const document = project.designStudioDocument;
  if (document === undefined || !held.delete(document)) return;
  for (const listener of listeners) listener();
}

/** True when a file or autosave holds this Studio document. */
export function diskCopyHoldsDesignDocument(document: DesignStudioDocument | undefined): boolean {
  return document !== undefined && held.has(document);
}

export function subscribeDesignDocumentCopies(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
