// design-session-storage — the Studio drawing survives a page reload
// (ADR-272 Amendment 3).
//
// Everything else about a session is deliberately ephemeral, but the DRAWING
// is work: a refresh, a crash, or a closed tab used to discard it entirely,
// and the apply record with it — so the next Apply after a reload duplicated
// the part instead of updating it.
//
// Only the durable slice is written: the sketch, which layer is armed, which
// surface is showing, and what the last Apply put in the scene. History,
// selection, and live gestures are not — an undo stack that outlives the tab
// invites undoing into a project state that no longer exists.
//
// Storage is best-effort in both directions. A quota error, a private-mode
// throw, or a corrupt payload costs the restore, never the session (rule 7:
// nothing here may block drawing). One thing is not best-effort: a drawing
// this page did not open is never written over. Opening the Studio on another
// project moves it to the kept drawings first (ADR-590 Amendment 1), and if
// that move fails the slot is held for the rest of the page.

import type { Sketch } from '../../core/design';
import type { DesignApplyRecord } from '../state/design-apply-record';

const STORAGE_KEY = 'laserforge.design-studio-session.v1';
const PERSISTED_VERSION = 1;

// A sketch is hand-drawn geometry, so it is small; a runaway freehand path is
// the only realistic way to approach a storage quota. Past this the drawing
// simply is not persisted — writing a truncated sketch would be worse.
export const MAX_PERSISTED_CHARS = 2_000_000;

export type PersistedDesignSession = {
  readonly projectOwner?: string;
  readonly sketch: Sketch;
  readonly activeLayerId: string;
  readonly surface3d: boolean;
  readonly applied: DesignApplyRecord | null;
  readonly dirtySinceApply?: boolean;
  /** The file the drawing's project was saved or opened as; null while it
   *  has none. Absent from drawings saved before ADR-590 Amendment 3. */
  readonly projectName?: string | null;
  /** True when a saved file or an autosave holds the drawing's last Apply,
   *  false when only this drawing does. Absent when not known. */
  readonly projectHoldsApply?: boolean;
};

export type StoredShape = {
  readonly projectOwner?: string;
  readonly version: number;
  readonly sketch: Sketch;
  readonly activeLayerId: string;
  readonly surface3d: boolean;
  readonly dirtySinceApply?: boolean;
  readonly projectName?: string | null;
  readonly projectHoldsApply?: boolean;
  // Sets and Maps do not survive JSON, so they travel as arrays.
  readonly appliedObjectIds?: ReadonlyArray<string>;
  readonly appliedOperationsByLayer?: ReadonlyArray<readonly [string, string]>;
};

let slotHeld = false;

/** Keeps a drawing that could not be moved aside from being written over. */
export function holdPersistedSession(): void {
  slotHeld = true;
}

export function writePersistedSession(session: PersistedDesignSession): void {
  try {
    if (typeof localStorage === 'undefined' || slotHeld) return;
    const payload = JSON.stringify(storedDesignSession(session));
    if (payload.length > MAX_PERSISTED_CHARS) return;
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* storage unavailable or full — the in-memory session still works */
  }
}

export function storedDesignSession(session: PersistedDesignSession): StoredShape {
  return {
    version: PERSISTED_VERSION,
    ...(session.projectOwner === undefined ? {} : { projectOwner: session.projectOwner }),
    sketch: session.sketch,
    activeLayerId: session.activeLayerId,
    surface3d: session.surface3d,
    ...(session.dirtySinceApply === undefined ? {} : { dirtySinceApply: session.dirtySinceApply }),
    ...(session.projectName === undefined ? {} : { projectName: session.projectName }),
    ...(session.projectHoldsApply === undefined
      ? {}
      : { projectHoldsApply: session.projectHoldsApply }),
    ...(session.applied === null
      ? {}
      : {
          appliedObjectIds: [...session.applied.objectIds],
          appliedOperationsByLayer: [...session.applied.operationIdByLayerId].map(
            ([layerId, operationId]) => [layerId, operationId] as const,
          ),
        }),
  };
}

export function readPersistedSession(): PersistedDesignSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return persistedFromStored(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function clearPersistedSession(): void {
  slotHeld = false;
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do — the next write overwrites it anyway */
  }
}

// Untrusted input: anything shaped wrong reads as "no saved drawing" rather
// than throwing into the open path.
export function persistedFromStored(value: unknown): PersistedDesignSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Partial<StoredShape>;
  if (stored.version !== PERSISTED_VERSION) return null;
  const sketch = stored.sketch;
  if (typeof sketch !== 'object' || sketch === null || !Array.isArray(sketch.entities)) return null;
  if (typeof stored.activeLayerId !== 'string') return null;
  return {
    sketch,
    ...(typeof stored.projectOwner === 'string' ? { projectOwner: stored.projectOwner } : {}),
    activeLayerId: stored.activeLayerId,
    surface3d: stored.surface3d !== false,
    applied: appliedFromStored(stored),
    ...(typeof stored.dirtySinceApply === 'boolean'
      ? { dirtySinceApply: stored.dirtySinceApply }
      : {}),
    ...(typeof stored.projectName === 'string' || stored.projectName === null
      ? { projectName: stored.projectName }
      : {}),
    ...(typeof stored.projectHoldsApply === 'boolean'
      ? { projectHoldsApply: stored.projectHoldsApply }
      : {}),
  };
}

function appliedFromStored(stored: Partial<StoredShape>): DesignApplyRecord | null {
  const objectIds = stored.appliedObjectIds;
  const pairs = stored.appliedOperationsByLayer;
  if (!Array.isArray(objectIds) || !Array.isArray(pairs)) return null;
  return {
    objectIds: new Set(objectIds.filter((id): id is string => typeof id === 'string')),
    operationIdByLayerId: new Map(
      pairs.filter(
        (pair): pair is readonly [string, string] =>
          Array.isArray(pair) && typeof pair[0] === 'string' && typeof pair[1] === 'string',
      ),
    ),
  };
}
