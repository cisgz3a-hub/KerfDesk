// Design Studio ephemeral session store (ADR-268, Phase N).
//
// Standalone on purpose, exactly like the Image Studio store: the sketch, the
// active tool, the view, the selection, and the Studio's own undo history must
// never enter the project store or project undo. Closing STASHES the session
// and asks nothing (rule 7); reopening resumes it. Apply is the one and only
// write into the project, as a single undo entry.

import { create } from 'zustand';
import {
  addEntity,
  removeEntities,
  replaceEntity,
  type Sketch,
  type SketchEntity,
} from '../../core/design';
import type { Vec2 } from '../../core/scene';
import { draftToEntity, type DesignDraft } from './design-draft';
import { applyEntityField } from './design-entity-edit';
import type { MeasurementKey } from './design-entity-fields';
import { entitiesInRectMm } from './design-hit-test';
import {
  createDesignSession,
  redoSession,
  sessionSketch,
  undoSession,
  withSketch,
  type DesignMarquee,
  type DesignSession,
  type DesignView,
} from './design-session';
import type { DesignToolKind } from './design-tool';

type DesignStudioState = {
  readonly session: DesignSession | null;
  // Retained across a close so reopening resumes the drawing in progress.
  readonly stash: DesignSession | null;
  readonly openStudio: () => void;
  readonly closeStudio: () => void;
  readonly setTool: (tool: DesignToolKind) => void;
  readonly setView: (view: DesignView) => void;
  readonly setCursorMm: (point: Vec2 | null) => void;
  readonly setSelection: (ids: ReadonlyArray<string>) => void;
  readonly toggleSnap: () => void;
  readonly toggleOrtho: () => void;
  readonly toggleGrid: () => void;
  readonly setSketch: (sketch: Sketch) => void;
  readonly drawEntity: (entity: SketchEntity) => void;
  readonly updateEntity: (entity: SketchEntity) => void;
  readonly setDraft: (draft: DesignDraft | null) => void;
  // Commits the live draft as one entity and one undo step. The id comes from the
  // caller because pure core may not generate identity.
  readonly commitDraft: (id: string) => void;
  readonly setActiveMeasurement: (key: MeasurementKey | null) => void;
  // Types an exact value into one dimension of one entity.
  readonly editEntityField: (id: string, key: MeasurementKey, value: number) => void;
  readonly setMarquee: (marquee: DesignMarquee | null) => void;
  readonly commitMarquee: (additive: boolean) => void;
  readonly deleteSelected: () => void;
  readonly duplicateEntity: (id: string, newId: string, offsetMm: number) => void;
  readonly setConstruction: (id: string, construction: boolean) => void;
  readonly undo: () => void;
  readonly redo: () => void;
};

export const useDesignStudioStore = create<DesignStudioState>((set) => ({
  session: null,
  stash: null,

  openStudio: () =>
    set((state) =>
      state.session !== null ? state : { session: state.stash ?? createDesignSession() },
    ),

  // No confirmation, no "discard changes?" — the session survives in the stash
  // and the operator gets it back untouched on reopen.
  closeStudio: () =>
    set((state) => (state.session === null ? state : { session: null, stash: state.session })),

  setTool: (tool) => set(mapSession((session) => ({ ...session, tool }))),
  setView: (view) => set(mapSession((session) => ({ ...session, view }))),
  setCursorMm: (cursorMm) => set(mapSession((session) => ({ ...session, cursorMm }))),
  setSelection: (ids) => set(mapSession((session) => ({ ...session, selectedIds: new Set(ids) }))),

  toggleSnap: () =>
    set(mapSession((session) => ({ ...session, snapEnabled: !session.snapEnabled }))),
  toggleOrtho: () =>
    set(mapSession((session) => ({ ...session, orthoEnabled: !session.orthoEnabled }))),
  toggleGrid: () => set(mapSession((session) => ({ ...session, showGrid: !session.showGrid }))),

  setSketch: (sketch) => set(mapSession((session) => withSketch(session, sketch))),
  drawEntity: (entity) =>
    set(mapSession((session) => withSketch(session, addEntity(sessionSketch(session), entity)))),
  updateEntity: (entity) =>
    set(
      mapSession((session) => withSketch(session, replaceEntity(sessionSketch(session), entity))),
    ),

  setDraft: (draft) => set(mapSession((session) => ({ ...session, draft }))),
  commitDraft: (id) => set(mapSession((session) => commitSessionDraft(session, id))),

  setActiveMeasurement: (activeMeasurement) =>
    set(mapSession((session) => ({ ...session, activeMeasurement }))),
  editEntityField: (id, key, value) =>
    set(mapSession((session) => editSessionField(session, id, key, value))),

  setMarquee: (marquee) => set(mapSession((session) => ({ ...session, marquee }))),
  commitMarquee: (additive) =>
    set(mapSession((session) => commitSessionMarquee(session, additive))),

  deleteSelected: () =>
    set(
      mapSession((session) => ({
        ...withSketch(session, removeEntities(sessionSketch(session), session.selectedIds)),
        selectedIds: new Set<string>(),
      })),
    ),
  duplicateEntity: (id, newId, offsetMm) =>
    set(mapSession((session) => duplicateSessionEntity(session, id, newId, offsetMm))),
  setConstruction: (id, construction) =>
    set(mapSession((session) => setSessionConstruction(session, id, construction))),

  undo: () => set(mapSession(undoSession)),
  redo: () => set(mapSession(redoSession)),
}));

// The draft becomes an entity, the entity becomes one history step, and the new
// entity becomes the selection — so the operator can immediately edit what they
// just drew. A degenerate draft simply clears (a click is not a draw).
function commitSessionDraft(session: DesignSession, id: string): DesignSession {
  if (session.draft === null) return session;
  const entity = draftToEntity(session.draft, id);
  const cleared: DesignSession = { ...session, draft: null };
  if (entity === null) return cleared;
  const next = addEntity(sessionSketch(session), entity);
  if (next === sessionSketch(session)) return cleared;
  return { ...withSketch(cleared, next), selectedIds: new Set([entity.id]) };
}

// The copy lands offset so it is visibly a second shape rather than hiding
// exactly on top of the original, and becomes the selection so it can be moved.
function duplicateSessionEntity(
  session: DesignSession,
  id: string,
  newId: string,
  offsetMm: number,
): DesignSession {
  const sketch = sessionSketch(session);
  const source = sketch.entities.find((candidate) => candidate.id === id);
  if (source === undefined) return session;
  const moved = translateEntity(source, newId, offsetMm);
  const next = addEntity(sketch, moved);
  if (next === sketch) return session;
  return { ...withSketch(session, next), selectedIds: new Set([newId]) };
}

function translateEntity(entity: SketchEntity, newId: string, deltaMm: number): SketchEntity {
  const shift = (point: { readonly x: number; readonly y: number }) => ({
    x: point.x + deltaMm,
    y: point.y + deltaMm,
  });
  switch (entity.kind) {
    case 'rect':
      return { ...entity, id: newId, origin: shift(entity.origin) };
    case 'circle':
    case 'arc':
      return { ...entity, id: newId, center: shift(entity.center) };
    case 'line':
      return { ...entity, id: newId, start: shift(entity.start), end: shift(entity.end) };
    case 'path':
      return { ...entity, id: newId, points: entity.points.map(shift) };
  }
}

function setSessionConstruction(
  session: DesignSession,
  id: string,
  construction: boolean,
): DesignSession {
  const sketch = sessionSketch(session);
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return session;
  return withSketch(session, replaceEntity(sketch, { ...entity, construction }));
}

// One typed value becomes one history step, so Ctrl+Z steps back through edits
// the same way it steps back through drawn shapes.
function editSessionField(
  session: DesignSession,
  id: string,
  key: MeasurementKey,
  value: number,
): DesignSession {
  const sketch = sessionSketch(session);
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (entity === undefined) return session;
  const edited = applyEntityField(entity, key, value);
  if (edited === null) return session;
  return withSketch(session, replaceEntity(sketch, edited));
}

function commitSessionMarquee(session: DesignSession, additive: boolean): DesignSession {
  if (session.marquee === null) return session;
  const enclosed = entitiesInRectMm(
    sessionSketch(session),
    session.marquee.anchorMm,
    session.marquee.pointerMm,
  ).map((entity) => entity.id);
  const selectedIds = additive ? new Set([...session.selectedIds, ...enclosed]) : new Set(enclosed);
  return { ...session, marquee: null, selectedIds };
}

// Every session mutation goes through here so a closed Studio silently ignores
// stray actions instead of resurrecting a session.
function mapSession(
  change: (session: DesignSession) => DesignSession,
): (state: DesignStudioState) => Partial<DesignStudioState> {
  return (state) => (state.session === null ? state : { session: change(state.session) });
}
