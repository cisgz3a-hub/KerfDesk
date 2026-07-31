// design-history — session-local undo for the Design Studio (ADR-271, DS-2).
//
// Deliberately NOT the project undo stack. Drawing produces many small steps
// and the operator should be able to undo a stray click without disturbing the
// project's history; the project sees exactly one entry, at Apply. This mirrors
// Image Studio, which keeps its own editor-local history for the same reason.
//
// A Sketch is small structured JSON, so whole-sketch snapshots are affordable
// and there is no need for Image Studio's copy-on-write tile machinery. Past
// entries beyond the depth cap are evicted oldest-first and COUNTED, so the
// status bar can say how many steps were dropped. That is an advisory, never a
// refusal (rule 7).

import type { Sketch } from '../../core/design';

export const DESIGN_HISTORY_DEPTH = 200;

export type DesignHistory = {
  readonly past: ReadonlyArray<Sketch>;
  readonly present: Sketch;
  readonly future: ReadonlyArray<Sketch>;
  // How many past steps have been evicted over the life of this session.
  readonly trimmedCount: number;
};

export function createDesignHistory(present: Sketch): DesignHistory {
  return { past: [], present, future: [], trimmedCount: 0 };
}

// Records a new state. A commit that does not change the sketch is ignored, so
// a click that moved nothing does not consume an undo step.
export function commitSketch(history: DesignHistory, next: Sketch): DesignHistory {
  if (next === history.present) return history;
  const grown = [...history.past, history.present];
  const overflow = Math.max(0, grown.length - DESIGN_HISTORY_DEPTH);
  return {
    past: overflow > 0 ? grown.slice(overflow) : grown,
    present: next,
    future: [],
    trimmedCount: history.trimmedCount + overflow,
  };
}

// Replaces the present WITHOUT recording a step. Used only for the live phase of a
// drag: the gesture pushes exactly one entry when it ends, so dragging a shape 200
// pixels does not bury the previous action under 200 undo steps.
export function replacePresent(history: DesignHistory, present: Sketch): DesignHistory {
  return present === history.present ? history : { ...history, present };
}

export function canUndo(history: DesignHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: DesignHistory): boolean {
  return history.future.length > 0;
}

export function undoSketch(history: DesignHistory): DesignHistory {
  const previous = history.past[history.past.length - 1];
  if (previous === undefined) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
    trimmedCount: history.trimmedCount,
  };
}

export function redoSketch(history: DesignHistory): DesignHistory {
  const next = history.future[0];
  if (next === undefined) return history;
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
    trimmedCount: history.trimmedCount,
  };
}
