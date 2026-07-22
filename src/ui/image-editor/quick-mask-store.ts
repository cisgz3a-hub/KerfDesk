// Quick Mask mode (ADR-242, PP-F): Photoshop's paint-a-selection rubylith.
// Q lifts the current selection into a paintable greyscale buffer (black =
// selected ink, white = clear); brush/pencil/eraser/line strokes route here
// instead of the document; Q again converts the ink back into a selection.
// Separate store: the session store sits at its size cap, and the rubylith
// is editor-ephemeral (never part of Apply).

import { create } from 'zustand';
import {
  captureRect,
  createEditHistory,
  pushHistoryEntry,
  redoInPlace,
  undoInPlace,
  RGBA_CHANNELS,
  type EditHistory,
  type RgbaBuffer,
} from '../../core/image-edit';
import {
  paintStrokeInPlace,
  snapLineEnd45,
  strokeDirtyRect,
  type PaintPoint,
} from '../../core/image-edit';
import type { SelectionMask } from '../../core/image-select';
import { brushFor, WHITE, BLACK, withSelection } from './editor-session';
import { useImageEditorStore } from './image-editor-store';

const INK_LUMA_R = 0.299;
const INK_LUMA_G = 0.587;
const INK_LUMA_B = 0.114;

type QuickMaskState = {
  /** White = unselected, painted ink = selected; null = mode off. */
  readonly rubylith: RgbaBuffer | null;
  /** Bumped per stroke so the canvas redraws (the buffer mutates in place). */
  readonly revision: number;
  /** Mode-local undo over rubylith strokes (V2 plan A2); reset on toggle. */
  readonly history: EditHistory;
  readonly toggle: () => void;
  /** Paint into the rubylith; returns false when the mode is off. */
  readonly strokeInto: (points: readonly PaintPoint[]) => boolean;
  readonly lineInto: (from: PaintPoint, to: PaintPoint, constrain45: boolean) => boolean;
  /** Undo/redo one rubylith stroke; false when the mode is off or empty. */
  readonly undoStroke: () => boolean;
  readonly redoStroke: () => boolean;
};

export const useQuickMaskStore = create<QuickMaskState>((set, get) => ({
  rubylith: null,
  revision: 0,
  history: createEditHistory(),

  toggle: () => {
    const editor = useImageEditorStore.getState();
    const session = editor.session;
    if (session === null || editor.transform !== null) return;
    const { rubylith } = get();
    if (rubylith === null) {
      set({
        rubylith: rubylithFromSelection(session.doc, session.selection),
        history: createEditHistory(),
      });
      // The ants would fight the red overlay; the mask carries the state now.
      useImageEditorStore.setState({ session: withSelection(session, null) });
      return;
    }
    set({ rubylith: null, history: createEditHistory() });
    useImageEditorStore.setState({
      session: withSelection(session, selectionFromRubylith(rubylith)),
    });
  },

  strokeInto: (points) => {
    const { rubylith, history } = get();
    if (rubylith === null) return false;
    const editor = useImageEditorStore.getState();
    const isEraser = editor.tool.kind === 'eraser';
    const stroke = {
      points,
      brush: brushFor(editor.tool, editor.brush),
      // Ink is binary intent: paint selects (black), the eraser clears.
      color: isEraser ? WHITE : BLACK,
    };
    const rect = strokeDirtyRect(stroke, rubylith);
    if (rect.width === 0 || rect.height === 0) return true;
    const entry = captureRect(rubylith, rect, 'Quick Mask stroke');
    paintStrokeInPlace(rubylith, stroke);
    set((s) => ({ revision: s.revision + 1, history: pushHistoryEntry(history, entry) }));
    return true;
  },

  undoStroke: () => {
    const { rubylith, history } = get();
    if (rubylith === null) return false;
    const result = undoInPlace(history, rubylith);
    if (result.applied === null) return true; // mode on, nothing to undo — consumed
    set((s) => ({ revision: s.revision + 1, history: result.history }));
    return true;
  },

  redoStroke: () => {
    const { rubylith, history } = get();
    if (rubylith === null) return false;
    const result = redoInPlace(history, rubylith);
    if (result.applied === null) return true;
    set((s) => ({ revision: s.revision + 1, history: result.history }));
    return true;
  },

  lineInto: (from, to, constrain45) => {
    const { rubylith, strokeInto } = get();
    if (rubylith === null) return false;
    return strokeInto([from, constrain45 ? snapLineEnd45(from, to) : to]);
  },
}));

function rubylithFromSelection(doc: RgbaBuffer, selection: SelectionMask | null): RgbaBuffer {
  const data = new Uint8ClampedArray(doc.width * doc.height * RGBA_CHANNELS);
  data.fill(255);
  const rubylith: RgbaBuffer = { width: doc.width, height: doc.height, data };
  if (selection === null) return rubylith;
  for (let i = 0; i < selection.alpha.length; i += 1) {
    const ink = 255 - (selection.alpha[i] ?? 0);
    const base = i * RGBA_CHANNELS;
    rubylith.data[base] = ink;
    rubylith.data[base + 1] = ink;
    rubylith.data[base + 2] = ink;
  }
  return rubylith;
}

function selectionFromRubylith(rubylith: RgbaBuffer): SelectionMask | null {
  const alpha = new Uint8Array(rubylith.width * rubylith.height);
  let selected = false;
  for (let i = 0; i < alpha.length; i += 1) {
    const base = i * RGBA_CHANNELS;
    const luma =
      INK_LUMA_R * (rubylith.data[base] ?? 0) +
      INK_LUMA_G * (rubylith.data[base + 1] ?? 0) +
      INK_LUMA_B * (rubylith.data[base + 2] ?? 0);
    const value = Math.round(255 - luma);
    alpha[i] = value;
    if (value > 0) selected = true;
  }
  if (!selected) return null;
  return { width: rubylith.width, height: rubylith.height, alpha };
}

// A closed or different session drops the mode (the rubylith is dimensioned
// for exactly one document).
useImageEditorStore.subscribe((state, prev) => {
  if (state.session?.objectId === prev.session?.objectId) return;
  if (useQuickMaskStore.getState().rubylith !== null) {
    useQuickMaskStore.setState({ rubylith: null });
  }
});
