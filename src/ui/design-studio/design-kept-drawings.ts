// design-kept-drawings — Studio drawings set aside instead of written over
// (ADR-590 Amendment 1).
//
// The saved drawing is one slot, and opening the Studio on a project it does
// not belong to used to write that project's drawing over it: a restart that
// opened the Studio before the autosave, or an autosave a few seconds older
// than the drawing, lost the only copy. A drawing with work not yet applied is
// now moved here first, and so is an applied one that the opened project does
// not hold (ADR-590 Amendment 2). The newest few are kept; one comes back by
// itself when its project returns, and the Studio offers the rest to restore.
//
// Best-effort like the slot (ADR-272 Amendment 3): every read treats the
// payload as untrusted, and a failed write reports false so the caller can
// hold the slot rather than lose the drawing.

import type { Sketch } from '../../core/design';
import type { Project } from '../../core/scene';
import {
  MAX_PERSISTED_CHARS,
  persistedFromStored,
  storedDesignSession,
  type PersistedDesignSession,
} from './design-session-storage';

const KEPT_KEY = 'laserforge.design-studio-kept-drawings.v1';
const KEPT_VERSION = 1;
const MAX_KEPT = 5;

export type KeptDesignDrawing = PersistedDesignSession & {
  readonly id: string;
  readonly keptAt: number;
};

let cached: { readonly raw: string | null; readonly list: readonly KeptDesignDrawing[] } = {
  raw: null,
  list: [],
};
const listeners = new Set<() => void>();

/** Newest first. The same array comes back until storage changes, so React can
 *  read it through useSyncExternalStore. */
export function readKeptDesignDrawings(): readonly KeptDesignDrawing[] {
  const raw = readRaw();
  if (raw !== cached.raw) cached = { raw, list: parseKept(raw) };
  return cached.list;
}

export function subscribeKeptDesignDrawings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** A saved drawing worth keeping when the Studio opens `project` in its place:
 *  one with shapes never applied, or an applied one that `project` does not
 *  hold but may be an earlier state of its project. An Apply in the 30 s
 *  before a crash is in the drawing and not in the autosave. */
export function worthKeeping(draft: PersistedDesignSession, project: Project): boolean {
  if (draft.sketch.entities.length === 0) return false;
  if (draft.dirtySinceApply !== false) return true;
  return !projectHoldsDrawing(project, draft) && mayPrecede(project, draft);
}

/** True when `project`'s own Studio drawing is this one, so opening the
 *  project again gives it back. */
export function projectHoldsDrawing(project: Project, draft: PersistedDesignSession): boolean {
  const own = project.designStudioDocument?.sketch;
  return own !== undefined && sameSketch(own, draft.sketch);
}

// An autosave or file from before the drawing's latest Apply has no Studio
// drawing yet (the blank start-up project has none either), or shares a shape
// or an operation with it. Another project's own Studio drawing shares
// neither, and its file holds it, so switching between two projects does not
// keep each one's drawing in the other.
function mayPrecede(project: Project, draft: PersistedDesignSession): boolean {
  const own = project.designStudioDocument;
  if (own === undefined) return true;
  const shapes = new Set(own.sketch.entities.map((entity) => entity.id));
  if (draft.sketch.entities.some((entity) => shapes.has(entity.id))) return true;
  const operations = new Set(project.scene.layers.map((layer) => layer.id));
  return [...(draft.applied?.operationIdByLayerId.values() ?? [])].some((id) => operations.has(id));
}

// One sketch came through the saved drawing's JSON and the other through the
// project file, so equal JSON settles it, and otherwise they are compared with
// their keys in one order. A sketch can hold a million points, so different
// shapes are told apart by their ids before either is written out.
function sameSketch(a: Sketch, b: Sketch): boolean {
  if (a === b) return true;
  if (
    a.entities.length !== b.entities.length ||
    a.entities.some((entity, index) => entity.id !== b.entities[index]?.id)
  )
    return false;
  return JSON.stringify(a) === JSON.stringify(b) || canonicalJson(a) === canonicalJson(b);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}

/** Adds `draft` as the newest kept drawing, dropping the oldest past the limit.
 *  An identical drawing already kept is not stored twice. */
export function keepDesignDrawing(
  draft: PersistedDesignSession,
  keptAt: number = Date.now(),
): boolean {
  const entry = { ...draft, id: crypto.randomUUID(), keptAt };
  const same = JSON.stringify(storedDesignSession(draft));
  const others = readKeptDesignDrawings().filter(
    (kept) => JSON.stringify(storedDesignSession(kept)) !== same,
  );
  const list = [entry, ...others].sort((a, b) => b.keptAt - a.keptAt).slice(0, MAX_KEPT);
  while (list.length > 0) {
    if (!list.includes(entry)) return false;
    if (writeKept(list)) return true;
    list.pop();
  }
  return false;
}

/** Removes and returns the newest kept drawing that `pick` accepts. */
export function takeKeptDesignDrawing(
  pick: (drawing: KeptDesignDrawing) => boolean,
): KeptDesignDrawing | null {
  const list = readKeptDesignDrawings();
  const taken = list.find(pick);
  if (taken === undefined || !writeKept(list.filter((drawing) => drawing !== taken))) return null;
  return taken;
}

export function discardKeptDesignDrawing(id: string): void {
  writeKept(readKeptDesignDrawings().filter((drawing) => drawing.id !== id));
}

/** Drops each kept drawing that was applied and that `project` holds: opening
 *  that project gives it back, so the Studio need not offer it. */
export function discardKeptDrawingsHeldBy(project: Project): void {
  const list = readKeptDesignDrawings();
  const rest = list.filter(
    (drawing) => drawing.dirtySinceApply !== false || !projectHoldsDrawing(project, drawing),
  );
  if (rest.length !== list.length) writeKept(rest);
}

export function clearKeptDesignDrawings(): void {
  writeKept([]);
}

function writeKept(list: readonly KeptDesignDrawing[]): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (list.length === 0) localStorage.removeItem(KEPT_KEY);
    else {
      const payload = JSON.stringify({
        version: KEPT_VERSION,
        drawings: list.map((drawing) => ({
          id: drawing.id,
          keptAt: drawing.keptAt,
          drawing: storedDesignSession(drawing),
        })),
      });
      if (payload.length > MAX_PERSISTED_CHARS) return false;
      localStorage.setItem(KEPT_KEY, payload);
    }
  } catch {
    return false;
  }
  for (const listener of listeners) listener();
  return true;
}

function readRaw(): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(KEPT_KEY);
  } catch {
    return null;
  }
}

function parseKept(raw: string | null): readonly KeptDesignDrawing[] {
  if (raw === null) return [];
  try {
    const stored = JSON.parse(raw) as { readonly version?: unknown; readonly drawings?: unknown };
    if (stored.version !== KEPT_VERSION || !Array.isArray(stored.drawings)) return [];
    return stored.drawings.flatMap((value: unknown): KeptDesignDrawing[] => {
      if (typeof value !== 'object' || value === null) return [];
      const entry = value as {
        readonly id?: unknown;
        readonly keptAt?: unknown;
        drawing?: unknown;
      };
      const drawing = persistedFromStored(entry.drawing);
      if (drawing === null || typeof entry.id !== 'string' || typeof entry.keptAt !== 'number')
        return [];
      return [{ ...drawing, id: entry.id, keptAt: entry.keptAt }];
    });
  } catch {
    return [];
  }
}
