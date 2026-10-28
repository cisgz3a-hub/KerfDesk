// design-kept-drawing-actions — bringing back a kept Studio drawing, and the
// unapplied drawing the unsaved-changes prompt counts (ADR-590 Amendment 1).

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
  holdsUnappliedWork,
  keepDesignDrawing,
  takeKeptDesignDrawing,
} from './design-kept-drawings';
import { reconcileProjectDesignSession } from './project-design-session';

/** Opens the kept drawing `id` in the Studio. A drawing it replaces that holds
 *  work not yet applied is kept in its place, so a restore never loses one. */
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
  if (holdsUnappliedWork(replaced) && !keepDesignDrawing(replaced)) {
    keepDesignDrawing(kept, kept.keptAt);
    return false;
  }
  useDesignStudioStore.setState({
    session: reconcileProjectDesignSession(restoreDesignSession(kept), project),
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
