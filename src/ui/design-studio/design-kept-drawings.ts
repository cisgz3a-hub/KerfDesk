// design-kept-drawings — Studio drawings set aside instead of written over
// (ADR-590 Amendment 1).
//
// The saved drawing is one slot, and opening the Studio on a project it does
// not belong to used to write that project's drawing over it: a restart that
// opened the Studio before the autosave, or an autosave a few seconds older
// than the drawing, lost the only copy. A drawing with work not yet applied is
// now moved here first, and so is an applied one that no saved file or
// autosave holds (ADR-590 Amendments 2 and 3). The newest few are kept; one
// comes back by itself when its project returns, and the Studio offers the
// rest to restore, naming the project each came from.
//
// Best-effort like the slot (ADR-272 Amendment 3): every read treats the
// payload as untrusted, and a failed write reports false so the caller can
// hold the slot rather than lose the drawing.

import type { Sketch } from '../../core/design';
import type { Project } from '../../core/scene';
import { diskCopyHoldsDesignDocument } from '../state/design-document-copies';
import { useToastStore } from '../state/toast-store';
import { persistedDesignSession, type DesignSession } from './design-session';
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
 *  hold and that no saved file or autosave holds either (ADR-590 Amendment
 *  3). An Apply in the 30 s before a crash is in the drawing and not in the
 *  autosave, so until a copy on disk holds it the drawing is its only copy. */
export function worthKeeping(draft: PersistedDesignSession, project: Project): boolean {
  if (draft.sketch.entities.length === 0) return false;
  if (draft.dirtySinceApply !== false) return true;
  if (projectHoldsDrawing(project, draft)) return false;
  if (draft.projectHoldsApply !== undefined) return !draft.projectHoldsApply;
  // A drawing saved before Amendment 3 does not say; guess as Amendment 2 did.
  return mayPrecede(project, draft);
}

/** The saved drawing for `session` on `project`: the project's owner key, the
 *  file it is saved or opened as, and whether that file or an autosave holds
 *  the drawing's last Apply (ADR-590 Amendment 3). */
export function savedDesignDrawing(
  session: DesignSession,
  projectOwner: string | undefined,
  project: Project,
  projectName: string | null,
): PersistedDesignSession {
  const drawing = persistedDesignSession(session, projectOwner);
  return {
    ...drawing,
    projectName,
    projectHoldsApply:
      drawing.dirtySinceApply === false &&
      diskCopyHoldsDesignDocument(project.designStudioDocument) &&
      projectHoldsDrawing(project, drawing),
  };
}

/** True when `project`'s own Studio drawing is this one, so opening the
 *  project again gives it back. */
export function projectHoldsDrawing(project: Project, draft: PersistedDesignSession): boolean {
  const own = project.designStudioDocument?.sketch;
  return own !== undefined && sameSketch(own, draft.sketch);
}

// Amendment 2's guess, kept for drawings that do not record whether a copy
// holds them: an autosave or file from before the drawing's latest Apply has
// no Studio drawing yet, or shares a shape or an operation with it.
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

/** Adds `draft` as the newest kept drawing. An identical drawing already kept
 *  is not stored twice. Past the limit, or when storage is full, the drawing
 *  that loses least is dropped, and the operator is told which. */
export function keepDesignDrawing(
  draft: PersistedDesignSession,
  keptAt: number = Date.now(),
): boolean {
  const entry = { ...draft, id: crypto.randomUUID(), keptAt };
  const same = JSON.stringify(storedDesignSession(draft));
  const others = readKeptDesignDrawings().filter(
    (kept) => JSON.stringify(storedDesignSession(kept)) !== same,
  );
  const list = [entry, ...others].sort((a, b) => b.keptAt - a.keptAt);
  const dropped: KeptDesignDrawing[] = [];
  while (list.length > MAX_KEPT) dropped.push(dropOne(list, entry));
  while (!writeKept(list)) {
    if (list.length === 1) return false;
    dropped.push(dropOne(list, entry));
  }
  if (dropped.length > 0) reportDropped(dropped);
  return true;
}

// The cheapest to lose goes first (ADR-590 Amendment 3): an applied drawing a
// copy on disk may hold, then an applied one only it holds, then unapplied
// work; the oldest first within each. The drawing being kept is never dropped.
function dropOne(list: KeptDesignDrawing[], keeping: KeptDesignDrawing): KeptDesignDrawing {
  let index = -1;
  list.forEach((drawing, at) => {
    if (drawing === keeping) return;
    const current = list[index];
    if (current === undefined || dropRank(drawing) <= dropRank(current)) index = at;
  });
  return list.splice(index, 1)[0]!;
}

function dropRank(drawing: KeptDesignDrawing): number {
  if (drawing.dirtySinceApply !== false) return 2;
  return drawing.projectHoldsApply === false ? 1 : 0;
}

function reportDropped(dropped: readonly KeptDesignDrawing[]): void {
  const named = dropped.map((drawing) => {
    const source = keptDrawingSource(drawing);
    return `${shapeCount(drawing)}${source === null ? '' : ` from ${source}`}, kept ${keptTimeLabel(drawing.keptAt)}`;
  });
  useToastStore
    .getState()
    .pushToast(
      `Design Studio keeps ${MAX_KEPT} drawings, so ${dropped.length === 1 ? 'one was' : `${dropped.length} were`} dropped to keep this one: ${named.join('; ')}.`,
      'warning',
    );
}

/** "3 shapes" or "1 shape". */
export function shapeCount(drawing: PersistedDesignSession): string {
  const shapes = drawing.sketch.entities.length;
  return `${shapes} ${shapes === 1 ? 'shape' : 'shapes'}`;
}

/** The project a kept drawing came from, as `"Bracket.lf2"` or "an untitled
 *  project", or null when it was kept before the source was recorded. */
export function keptDrawingSource(drawing: PersistedDesignSession): string | null {
  if (drawing.projectName === undefined) return null;
  return drawing.projectName === null ? 'an untitled project' : `"${drawing.projectName}"`;
}

export function keptTimeLabel(keptAt: number): string {
  return new Date(keptAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
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
