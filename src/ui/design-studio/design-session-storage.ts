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
// nothing here may block drawing).

import type { Sketch } from '../../core/design';
import type { DesignApplyRecord } from '../state/design-apply-record';

const STORAGE_KEY = 'laserforge.design-studio-session.v1';
const PERSISTED_VERSION = 1;

// A sketch is hand-drawn geometry, so it is small; a runaway freehand path is
// the only realistic way to approach a storage quota. Past this the drawing
// simply is not persisted — writing a truncated sketch would be worse.
const MAX_PERSISTED_CHARS = 2_000_000;

export type PersistedDesignSession = {
  readonly sketch: Sketch;
  readonly activeLayerId: string;
  readonly surface3d: boolean;
  readonly applied: DesignApplyRecord | null;
};

type StoredShape = {
  readonly version: number;
  readonly sketch: Sketch;
  readonly activeLayerId: string;
  readonly surface3d: boolean;
  // Sets and Maps do not survive JSON, so they travel as arrays.
  readonly appliedObjectIds?: ReadonlyArray<string>;
  readonly appliedOperationsByLayer?: ReadonlyArray<readonly [string, string]>;
};

export function writePersistedSession(session: PersistedDesignSession): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const stored: StoredShape = {
      version: PERSISTED_VERSION,
      sketch: session.sketch,
      activeLayerId: session.activeLayerId,
      surface3d: session.surface3d,
      ...(session.applied === null
        ? {}
        : {
            appliedObjectIds: [...session.applied.objectIds],
            appliedOperationsByLayer: [...session.applied.operationIdByLayerId].map(
              ([layerId, operationId]) => [layerId, operationId] as const,
            ),
          }),
    };
    const payload = JSON.stringify(stored);
    if (payload.length > MAX_PERSISTED_CHARS) return;
    localStorage.setItem(STORAGE_KEY, payload);
  } catch {
    /* storage unavailable or full — the in-memory session still works */
  }
}

export function readPersistedSession(): PersistedDesignSession | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    return fromStored(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function clearPersistedSession(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do — the next write overwrites it anyway */
  }
}

// Untrusted input: anything shaped wrong reads as "no saved drawing" rather
// than throwing into the open path.
function fromStored(value: unknown): PersistedDesignSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Partial<StoredShape>;
  if (stored.version !== PERSISTED_VERSION) return null;
  const sketch = stored.sketch;
  if (typeof sketch !== 'object' || sketch === null || !Array.isArray(sketch.entities)) return null;
  if (typeof stored.activeLayerId !== 'string') return null;
  return {
    sketch,
    activeLayerId: stored.activeLayerId,
    surface3d: stored.surface3d !== false,
    applied: appliedFromStored(stored),
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
