// design-kept-drawing-actions — bringing back a kept Studio drawing, and the
// unapplied drawing the unsaved-changes prompt counts (ADR-590 Amendments 1
// and 2).

import { useStore } from '../state';
import { designRecoveryOwner } from './design-recovery-owner';
import {
  persistedDesignSession,
  restoreDesignSession,
  sessionSketch,
  type DesignSession,
} from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import {
  keepDesignDrawing,
  projectHoldsDrawing,
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
  const replaced = persistedDesignSession(current, owner);
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

/** True while the Studio, open or closed, holds shapes drawn since the last
 *  Apply for the current project. */
export function designStudioHoldsUnappliedDrawing(): boolean {
  const studio = useDesignStudioStore.getState();
  if (studio.documentEpoch !== useStore.getState().projectDocumentEpoch) return false;
  const session: DesignSession | null = studio.session ?? studio.stash;
  return session !== null && session.dirtySinceApply && sessionSketch(session).entities.length > 0;
}
