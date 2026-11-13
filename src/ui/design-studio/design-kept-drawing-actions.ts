// design-kept-drawing-actions — bringing back a kept Studio drawing (ADR-590
// Amendments 1 and 2). The unapplied drawing the unsaved-changes prompt counts
// is studioHoldsUnappliedDrawing in design-studio-shell-link.ts.

import { useStore } from '../state';
import { designRecoveryOwner } from './design-recovery-owner';
import { restoreDesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import {
  keepDesignDrawing,
  projectHoldsDrawing,
  savedDesignDrawing,
  takeKeptDesignDrawing,
  worthKeeping,
} from './design-kept-drawings';
import { documentApplyRecord, reconcileProjectDesignSession } from './project-design-session';

/** Opens the kept drawing `id` in the Studio. A drawing it replaces that is
 *  worth keeping is kept in its place, so a restore never loses one. */
export async function restoreKeptDesignDrawing(id: string): Promise<boolean> {
  const { project, projectDocumentEpoch } = useStore.getState();
  const current = useDesignStudioStore.getState().session;
  if (current === null) return false;
  let owner: string | undefined;
  try {
    const pending = designRecoveryOwner(project);
    owner = pending instanceof Promise ? await pending : pending;
  } catch {
    owner = undefined;
  }
  const latest = useStore.getState();
  if (
    useDesignStudioStore.getState().session !== current ||
    latest.project !== project ||
    latest.projectDocumentEpoch !== projectDocumentEpoch
  )
    return false;
  const kept = takeKeptDesignDrawing((drawing) => drawing.id === id);
  if (kept === null) return false;
  const replaced = savedDesignDrawing(current, owner, project, latest.savedName);
  if (worthKeeping(replaced, project) && !keepDesignDrawing(replaced)) {
    keepDesignDrawing(kept, kept.keptAt);
    return false;
  }
  // The kept drawing takes the place of this project's own, so its next Apply
  // replaces what that drawing put in the scene instead of adding beside it.
  const own = project.designStudioDocument;
  const restored = reconcileProjectDesignSession(
    restoreDesignSession(own === undefined ? kept : { ...kept, applied: documentApplyRecord(own) }),
    project,
  );
  // A drawing applied to another state of the project is not applied to this
  // one, so Apply stays on until it is (ADR-590 Amendment 2).
  useDesignStudioStore.setState({
    session: projectHoldsDrawing(project, kept) ? restored : { ...restored, dirtySinceApply: true },
  });
  return true;
}
