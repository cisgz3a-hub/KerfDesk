// use-design-session-persistence — keeps the saved drawing in step with the
// live one (ADR-272 Amendment 3).
//
// Subscribes imperatively rather than through a selector: a drag fires store
// updates every pointer move, and re-rendering the host for each one to decide
// whether to save would be worse than the save. Writes are coalesced on a
// timer so a gesture costs one write, not one per frame, and a final write
// runs at unmount so nothing in flight is lost.

import { useEffect } from 'react';
import type { Project } from '../../core/scene';
import { useStore } from '../state';
import { sessionSketch, type DesignSession } from './design-session';
import { useDesignStudioStore } from './design-studio-store';
import { writePersistedSession } from './design-session-storage';
import {
  cancelPendingDesignRecoveryOwner,
  designRecoveryOwner,
  finishDesignRecoveryOwnerAtTeardown,
} from './design-recovery-owner';

// Long enough that a drag coalesces into a single write, short enough that a
// reload moments after drawing still finds the shape.
const SAVE_DEBOUNCE_MS = 400;

export function useDesignSessionPersistence(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let preparedProject: ReturnType<typeof useStore.getState>['project'] | null = null;

    const prepareOwner = () => {
      const { project, projectDocumentEpoch } = useStore.getState();
      if (preparedProject !== null && preparedProject !== project)
        cancelPendingDesignRecoveryOwner(preparedProject);
      preparedProject = project;
      const state = useDesignStudioStore.getState();
      if (state.documentEpoch !== projectDocumentEpoch || (state.session ?? state.stash) === null)
        return;
      const pending = designRecoveryOwner(project);
      if (pending instanceof Promise) void pending.catch(() => undefined);
    };

    const scheduleSave = () => {
      prepareOwner();
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        void saveCurrentSession(false);
      }, SAVE_DEBOUNCE_MS);
    };
    const unsubscribe = useDesignStudioStore.subscribe(scheduleSave);
    // Main-workspace edits change the saved project identity even while the
    // Studio drawing is stashed. Keep that same document's recovery owner current.
    const unsubscribeProject = useStore.subscribe((next, previous) => {
      if (
        next.project !== previous.project &&
        next.projectDocumentEpoch === previous.projectDocumentEpoch
      )
        scheduleSave();
    });
    prepareOwner();

    const flush = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      // Document teardown cannot await a task turn. Finish only remaining
      // current owner slices, even if the debounced save was awaiting them.
      void saveCurrentSession(true);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      unsubscribe();
      unsubscribeProject();
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, []);
}

async function saveCurrentSession(teardown: boolean): Promise<void> {
  // The stash also holds a drawing worth saving while the Studio is closed.
  const state = useDesignStudioStore.getState();
  const { project, projectDocumentEpoch } = useStore.getState();
  if (state.documentEpoch !== projectDocumentEpoch) return;
  const session = state.session ?? state.stash;
  if (session === null) return;
  let projectOwner: string | undefined;
  try {
    const pending = teardown
      ? finishDesignRecoveryOwnerAtTeardown(project)
      : designRecoveryOwner(project);
    projectOwner = pending instanceof Promise ? await pending : pending;
  } catch {
    return; // Preserve the last recovery draft when work was cancelled/refused.
  }
  if (!stillOwnsRecovery(project, projectDocumentEpoch, session)) return;
  writePersistedSession({
    ...(projectOwner === undefined ? {} : { projectOwner }),
    sketch: sessionSketch(session),
    activeLayerId: session.activeLayerId,
    surface3d: session.surface3d,
    applied: session.applied,
    dirtySinceApply: session.dirtySinceApply,
  });
}

function stillOwnsRecovery(project: Project, epoch: number, session: DesignSession): boolean {
  const latest = useDesignStudioStore.getState();
  return (
    useStore.getState().project === project &&
    useStore.getState().projectDocumentEpoch === epoch &&
    latest.documentEpoch === epoch &&
    (latest.session ?? latest.stash) === session
  );
}
