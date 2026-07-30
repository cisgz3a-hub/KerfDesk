// design-session — the Design Studio's session shape and its pure transitions
// (ADR-268, DS-2). Everything here is ephemeral: it lives only while the
// overlay is open, is stashed on close, and never reaches the project store or
// project undo. The one crossing point is Apply.

import { EMPTY_SKETCH, type Sketch } from '../../core/design';
import type { Vec2 } from '../../core/scene';
import {
  canRedo,
  canUndo,
  commitSketch,
  createDesignHistory,
  redoSketch,
  undoSketch,
  type DesignHistory,
} from './design-history';
import type { DesignDraft } from './design-draft';
import type { SnapTarget } from '../../core/design/snap';
import type { MeasurementKey } from './design-entity-fields';
import type { DesignToolKind } from './design-tool';

export type DesignView = {
  readonly pxPerMm: number;
  readonly panXmm: number;
  readonly panYmm: number;
};

export type DesignMarquee = {
  readonly anchorMm: Vec2;
  readonly pointerMm: Vec2;
};

export type DesignSession = {
  readonly history: DesignHistory;
  readonly tool: DesignToolKind;
  readonly selectedIds: ReadonlySet<string>;
  // null until the canvas has measured itself and framed the bed.
  readonly view: DesignView | null;
  readonly cursorMm: Vec2 | null;
  // In-progress gesture. Deliberately OUTSIDE history: a draft is not a state
  // worth undoing, only the entity it commits to is.
  readonly draft: DesignDraft | null;
  readonly marquee: DesignMarquee | null;
  // Which inspector field is being touched right now, so the canvas can call out
  // exactly the distance that field controls. Cleared on blur — the annotation is
  // a transient explanation, not a persistent overlay.
  readonly activeMeasurement: MeasurementKey | null;
  // The geometric snap currently under the pointer, so the canvas can mark it and
  // the status bar can name it. Purely a readout — the snapped point is already
  // baked into cursorMm and any live draft.
  readonly activeSnap: SnapTarget | null;
  readonly snapEnabled: boolean;
  readonly orthoEnabled: boolean;
  readonly showGrid: boolean;
  readonly gridMm: number;
  // True once the sketch has changed since the last Apply. Apply gates on THIS,
  // not on undo depth, because a view-only step must not look like a change and
  // a change that was undone-then-redone must still apply.
  readonly dirtySinceApply: boolean;
};

export const DEFAULT_DESIGN_GRID_MM = 10;

export function createDesignSession(sketch: Sketch = EMPTY_SKETCH): DesignSession {
  return {
    history: createDesignHistory(sketch),
    tool: 'select',
    selectedIds: new Set<string>(),
    view: null,
    cursorMm: null,
    draft: null,
    marquee: null,
    activeMeasurement: null,
    activeSnap: null,
    snapEnabled: true,
    orthoEnabled: false,
    showGrid: true,
    gridMm: DEFAULT_DESIGN_GRID_MM,
    dirtySinceApply: false,
  };
}

export function sessionSketch(session: DesignSession): Sketch {
  return session.history.present;
}

// The single place a sketch change enters the session, so "dirty" and history
// can never disagree.
export function withSketch(session: DesignSession, next: Sketch): DesignSession {
  if (next === sessionSketch(session)) return session;
  return {
    ...session,
    history: commitSketch(session.history, next),
    selectedIds: retainedSelection(session.selectedIds, next),
    dirtySinceApply: true,
  };
}

// Called after a successful Apply. History is deliberately NOT cleared: undo
// inside the Studio still walks the drawing, while the project keeps its own
// single undo entry for the apply itself.
export function markSessionApplied(session: DesignSession): DesignSession {
  return session.dirtySinceApply ? { ...session, dirtySinceApply: false } : session;
}

export function undoSession(session: DesignSession): DesignSession {
  if (!canUndo(session.history)) return session;
  const history = undoSketch(session.history);
  return {
    ...session,
    history,
    selectedIds: retainedSelection(session.selectedIds, history.present),
    dirtySinceApply: true,
  };
}

export function redoSession(session: DesignSession): DesignSession {
  if (!canRedo(session.history)) return session;
  const history = redoSketch(session.history);
  return {
    ...session,
    history,
    selectedIds: retainedSelection(session.selectedIds, history.present),
    dirtySinceApply: true,
  };
}

// Selection is by id, and undo can remove an entity out from under it. Dropping
// vanished ids keeps the inspector from reading a shape that is no longer there.
function retainedSelection(selectedIds: ReadonlySet<string>, sketch: Sketch): ReadonlySet<string> {
  if (selectedIds.size === 0) return selectedIds;
  const live = new Set(sketch.entities.map((entity) => entity.id));
  const kept = [...selectedIds].filter((id) => live.has(id));
  return kept.length === selectedIds.size ? selectedIds : new Set(kept);
}
