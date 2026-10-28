// design-draft-recovery — which drawing the Studio opens on, and what happens
// to a saved drawing that belongs elsewhere (ADR-272 Amendment 3, ADR-590 and
// its Amendment 1).
//
// The saved drawing opens only on the project it was drawn on. A drawing with
// work not yet applied that belongs to another project (another file, an older
// autosave of this one, or the blank start-up project) is moved to the kept
// drawings before this project's own drawing can be saved over it. A kept
// drawing whose project returns opens again by itself.
//
// Nothing here writes storage until the caller publishes the session: an open
// that a newer one supersedes must not take a kept drawing it never shows.

import type { Project } from '../../core/scene';
import { designRecoveryOwner } from './design-recovery-owner';
import { restoreDesignSession, type DesignSession } from './design-session';
import {
  clearPersistedSession,
  holdPersistedSession,
  readPersistedSession,
  type PersistedDesignSession,
} from './design-session-storage';
import {
  holdsUnappliedWork,
  keepDesignDrawing,
  readKeptDesignDrawings,
  takeKeptDesignDrawing,
} from './design-kept-drawings';
import {
  reconcileProjectDesignSession,
  restoreProjectDesignSession,
} from './project-design-session';

export type OpenedDesignSession = {
  readonly session: DesignSession;
  /** Moves the saved and kept drawings to match; run once, when publishing. */
  readonly settle: () => void;
};

export function restoredOwnedSession(
  project: Project,
  epoch: number,
): OpenedDesignSession | Promise<OpenedDesignSession> {
  // A drawing saved without an owner was drawn on the blank start-up project.
  // Deciding about it needs no project identity, and neither does a project
  // that no kept drawing could belong to, so those open at once.
  const blank = project.designStudioDocument === undefined && project.scene.objects.length === 0;
  const saved = readPersistedSession();
  if (saved?.projectOwner === undefined) {
    if (saved !== null && epoch === 0 && blank) return opened(restoreDraft(saved, project));
    const returnable = readKeptDesignDrawings().some((kept) => kept.projectOwner !== undefined);
    if (blank || !returnable) return projectSessionKeepingDraft(project);
  }
  const restore = (key: string | undefined): OpenedDesignSession => {
    const current = readPersistedSession();
    if (current !== null && draftBelongsTo(current, key, epoch))
      return opened(restoreDraft(current, project));
    const returning =
      key === undefined
        ? undefined
        : readKeptDesignDrawings().find((drawing) => drawing.projectOwner === key);
    if (returning === undefined) return projectSessionKeepingDraft(project);
    return opened(restoreDraft(returning, project), () => {
      takeKeptDesignDrawing((drawing) => drawing.id === returning.id);
      if (current !== null) setAside(current);
    });
  };
  const owner = designRecoveryOwner(project);
  return owner instanceof Promise ? owner.then(restore) : restore(owner);
}

/** The project's own applied drawing; a saved drawing with work not yet
 *  applied is kept rather than written over. Also the answer when the
 *  project's identity cannot be worked out. */
export function projectSessionKeepingDraft(project: Project): OpenedDesignSession {
  return opened(restoreProjectDesignSession(project), () => {
    const saved = readPersistedSession();
    if (saved !== null) setAside(saved);
  });
}

function opened(session: DesignSession, settle: () => void = () => undefined): OpenedDesignSession {
  return { session, settle };
}

// Only the epoch-zero blank document may reopen a drawing saved without an owner.
function draftBelongsTo(
  saved: PersistedDesignSession,
  key: string | undefined,
  epoch: number,
): boolean {
  return key === undefined
    ? epoch === 0 && saved.projectOwner === undefined
    : saved.projectOwner === key;
}

function restoreDraft(saved: PersistedDesignSession, project: Project): DesignSession {
  return reconcileProjectDesignSession(restoreDesignSession(saved), project);
}

function setAside(saved: PersistedDesignSession): void {
  if (!holdsUnappliedWork(saved)) return;
  if (keepDesignDrawing(saved)) clearPersistedSession();
  else holdPersistedSession();
}
