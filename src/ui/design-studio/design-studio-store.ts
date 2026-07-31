// Design Studio ephemeral session store (ADR-271, Phase N).
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
import type { SnapTarget } from '../../core/design/snap';
import type { Vec2 } from '../../core/scene';
import type { CornerOp } from './design-corner-apply';
import type { CornerPick } from './design-corner-pick';
import type { DesignDraft } from './design-draft';
import type { MeasurementKey } from './design-entity-fields';
import {
  applyCornerToSession,
  beginSessionMove,
  commitSessionDraft,
  commitSessionMarquee,
  duplicateSessionEntity,
  editSessionField,
  endSessionMove,
  nudgeSession,
  setSessionConstruction,
  updateSessionMove,
} from './design-session-mutations';
import {
  createDesignSession,
  markSessionApplied,
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
  readonly setActiveSnap: (target: SnapTarget | null) => void;
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
  // Applies the armed corner tool at a picked corner, as one history step.
  readonly applyCorner: (pick: CornerPick, op: CornerOp) => void;
  readonly setFilletRadiusMm: (radiusMm: number) => void;
  readonly setChamferDistanceMm: (distanceMm: number) => void;
  // Types an exact value into one dimension of one entity.
  readonly editEntityField: (id: string, key: MeasurementKey, value: number) => void;
  // A move gesture: begin on pointer-down over a selected shape, update per move,
  // commit ONE history step on release.
  readonly beginMove: (atMm: Vec2) => void;
  readonly updateMove: (atMm: Vec2) => void;
  readonly endMove: () => void;
  readonly nudgeSelection: (deltaMm: Vec2) => void;
  readonly setMarquee: (marquee: DesignMarquee | null) => void;
  readonly commitMarquee: (additive: boolean) => void;
  readonly deleteSelected: () => void;
  readonly duplicateEntity: (id: string, newId: string, offsetMm: number) => void;
  readonly setConstruction: (id: string, construction: boolean) => void;
  // Clears the dirty flag after the sketch has been written to the project.
  readonly markApplied: () => void;
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
  setActiveSnap: (activeSnap) => set(mapSession((session) => ({ ...session, activeSnap }))),
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

  applyCorner: (pick, op) => set(mapSession((session) => applyCornerToSession(session, pick, op))),
  setFilletRadiusMm: (filletRadiusMm) =>
    set(mapSession((session) => (filletRadiusMm > 0 ? { ...session, filletRadiusMm } : session))),
  setChamferDistanceMm: (chamferDistanceMm) =>
    set(
      mapSession((session) =>
        chamferDistanceMm > 0 ? { ...session, chamferDistanceMm } : session,
      ),
    ),

  setActiveMeasurement: (activeMeasurement) =>
    set(mapSession((session) => ({ ...session, activeMeasurement }))),
  editEntityField: (id, key, value) =>
    set(mapSession((session) => editSessionField(session, id, key, value))),

  beginMove: (atMm) => set(mapSession((session) => beginSessionMove(session, atMm))),
  updateMove: (atMm) => set(mapSession((session) => updateSessionMove(session, atMm))),
  endMove: () => set(mapSession(endSessionMove)),
  nudgeSelection: (deltaMm) => set(mapSession((session) => nudgeSession(session, deltaMm))),

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

  markApplied: () => set(mapSession(markSessionApplied)),

  undo: () => set(mapSession(undoSession)),
  redo: () => set(mapSession(redoSession)),
}));

// Every session mutation goes through here so a closed Studio silently ignores
// stray actions instead of resurrecting a session.
function mapSession(
  change: (session: DesignSession) => DesignSession,
): (state: DesignStudioState) => Partial<DesignStudioState> {
  return (state) => (state.session === null ? state : { session: change(state.session) });
}
