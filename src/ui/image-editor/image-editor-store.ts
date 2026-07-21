// Image Studio ephemeral session store (ADR-242, flows F-L1..F-L4).
//
// Separate from the project store on purpose: sessions, tools, and the
// editor's own undo history must never enter project undo. Closed sessions
// are stashed by object id and resumed on reopen — closing never asks
// anything (CLAUDE.md #7). Apply hands a rebuilt RasterImage to the project
// store as exactly one undo entry.

import { create } from 'zustand';
import type { PaintColor, PaintPoint } from '../../core/image-edit';
import { wandSelection, type SelectionMask } from '../../core/image-select';
import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  BLACK,
  commitFillSelection,
  commitLine,
  commitMoveSelection,
  commitStroke,
  createSession,
  redoSession,
  revertSession,
  undoSession,
  WHITE,
  withSelection,
  type BrushSettings,
  type EditorSession,
  type EditorTool,
} from './editor-session';
import { bakeBufferToBitmapFields, decodeRasterToBuffer } from './image-editor-decode';
import type { EditorView } from './image-editor-types';

const DEFAULT_BRUSH: BrushSettings = { diameterPx: 12, hardness: 0.8, opacity: 1 };
const DEFAULT_WAND_TOLERANCE = 32;

type LoadState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly objectId: string }
  | { readonly kind: 'failed'; readonly message: string };

type ImageEditorState = {
  readonly session: EditorSession | null;
  readonly stash: Readonly<Record<string, EditorSession>>;
  readonly loadState: LoadState;
  readonly tool: EditorTool;
  readonly brush: BrushSettings;
  /** Photoshop color pair: foreground paints, eraser erases TO background. */
  readonly foreground: PaintColor;
  readonly background: PaintColor;
  readonly wandTolerance: number;
  readonly wandContiguous: boolean;
  readonly isApplying: boolean;
  /** Viewport transform; null = fit-to-window on next canvas layout. */
  readonly view: EditorView | null;
  readonly viewportSize: { readonly width: number; readonly height: number };
  /** Held-Spacebar temporary Hand tool (Photoshop pan convention). */
  readonly isSpacePanning: boolean;
  readonly openEditor: (image: RasterImage) => void;
  readonly closeEditor: () => void;
  readonly setTool: (tool: EditorTool) => void;
  readonly setBrush: (brush: Partial<BrushSettings>) => void;
  readonly setForeground: (color: PaintColor) => void;
  readonly swapColors: () => void;
  readonly resetColors: () => void;
  readonly setView: (view: EditorView | null) => void;
  readonly setViewportSize: (width: number, height: number) => void;
  readonly zoomBy: (factor: number) => void;
  readonly zoomTo100: () => void;
  readonly setSpacePanning: (isPanning: boolean) => void;
  readonly setWandTolerance: (tolerance: number) => void;
  readonly setWandContiguous: (contiguous: boolean) => void;
  readonly stroke: (points: readonly PaintPoint[]) => void;
  readonly line: (from: PaintPoint, to: PaintPoint, constrain45: boolean) => void;
  readonly select: (mask: SelectionMask | null) => void;
  readonly wandAt: (x: number, y: number) => void;
  readonly deleteSelection: () => void;
  readonly fillSelection: () => void;
  readonly moveSelection: (dx: number, dy: number) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly revert: () => void;
  readonly apply: () => void;
};

export const useImageEditorStore = create<ImageEditorState>((set, get) => ({
  session: null,
  stash: {},
  loadState: { kind: 'idle' },
  tool: { kind: 'brush' },
  brush: DEFAULT_BRUSH,
  foreground: BLACK,
  background: WHITE,
  wandTolerance: DEFAULT_WAND_TOLERANCE,
  wandContiguous: true,
  isApplying: false,
  view: null,
  viewportSize: { width: 0, height: 0 },
  isSpacePanning: false,

  openEditor: (image) => openEditorAction(set, get, image),

  closeEditor: () => {
    const { session } = get();
    set((s) => ({
      session: null,
      loadState: { kind: 'idle' },
      view: null,
      isSpacePanning: false,
      stash: session === null ? s.stash : { ...s.stash, [session.objectId]: session },
    }));
  },

  setTool: (tool) => set({ tool }),
  setBrush: (brush) => set((s) => ({ brush: { ...s.brush, ...brush } })),
  setForeground: (color) => set({ foreground: color }),
  swapColors: () => set((s) => ({ foreground: s.background, background: s.foreground })),
  resetColors: () => set({ foreground: BLACK, background: WHITE }),
  setView: (view) => set({ view }),
  setViewportSize: (width, height) => set({ viewportSize: { width, height } }),
  zoomBy: (factor) => zoomByAction(set, get, factor),
  zoomTo100: () => zoomToScaleAction(set, get, 1),
  setSpacePanning: (isSpacePanning) => set({ isSpacePanning }),
  setWandTolerance: (wandTolerance) => set({ wandTolerance }),
  setWandContiguous: (wandContiguous) => set({ wandContiguous }),

  stroke: (points) =>
    withSession(set, get, (session, s) => {
      const label =
        s.tool.kind === 'eraser' ? 'Eraser' : s.tool.kind === 'pencil' ? 'Pencil' : 'Brush';
      // Photoshop semantics: the eraser paints the BACKGROUND color.
      const color = s.tool.kind === 'eraser' ? s.background : s.foreground;
      return commitStroke(session, s.tool, s.brush, color, points, label);
    }),
  line: (from, to, constrain45) =>
    withSession(set, get, (session, s) =>
      commitLine(session, s.brush, s.foreground, from, to, constrain45),
    ),

  select: (mask) => withSession(set, get, (session) => withSelection(session, mask)),
  wandAt: (x, y) =>
    withSession(set, get, (session, s) =>
      withSelection(
        session,
        wandSelection(session.doc, x, y, {
          tolerance: s.wandTolerance,
          contiguous: s.wandContiguous,
        }),
      ),
    ),
  deleteSelection: () =>
    withSession(set, get, (session) => commitFillSelection(session, WHITE, 'Delete selection')),
  fillSelection: () =>
    withSession(set, get, (session, s) =>
      commitFillSelection(session, s.foreground, 'Fill selection'),
    ),
  moveSelection: (dx, dy) =>
    withSession(set, get, (session) => commitMoveSelection(session, dx, dy)),

  undo: () => withSession(set, get, (session) => undoSession(session)),
  redo: () => withSession(set, get, (session) => redoSession(session)),
  revert: () => withSession(set, get, (session) => revertSession(session)),

  apply: () => applyAction(set, get),
}));

type Setter = (
  partial: Partial<ImageEditorState> | ((state: ImageEditorState) => Partial<ImageEditorState>),
) => void;

function openEditorAction(set: Setter, get: () => ImageEditorState, image: RasterImage): void {
  const { stash, session } = get();
  if (session !== null && session.objectId === image.id) return;
  const stashed = stash[image.id];
  if (stashed !== undefined) {
    set((s) => {
      const { [image.id]: _resumed, ...rest } = s.stash;
      return { session: stashed, stash: rest, loadState: { kind: 'idle' } };
    });
    return;
  }
  set({ loadState: { kind: 'loading', objectId: image.id } });
  decodeRasterToBuffer(image)
    .then((doc) => {
      // The open may have been superseded (closed / another image opened).
      if (get().loadState.kind !== 'loading') return;
      set({
        session: createSession(image.id, image.source, doc),
        loadState: { kind: 'idle' },
      });
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      set({ loadState: { kind: 'failed', message } });
      useToastStore.getState().pushToast(`Could not open image for editing: ${message}`, 'error');
    });
}

function applyAction(set: Setter, get: () => ImageEditorState): void {
  const { session, isApplying } = get();
  if (session === null || isApplying || session.history.undoStack.length === 0) return;
  set({ isApplying: true });
  bakeBufferToBitmapFields(session.doc)
    .then((fields) => {
      useStore.getState().applyEditedImage(session.objectId, fields);
      set((s) => ({
        isApplying: false,
        session: s.session === null ? null : { ...s.session, dirtySinceApply: false },
      }));
      useToastStore.getState().pushToast('Image edits applied.', 'success');
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      set({ isApplying: false });
      useToastStore.getState().pushToast(`Could not apply image edits: ${message}`, 'error');
    });
}

function withSession(
  set: Setter,
  get: () => ImageEditorState,
  update: (session: EditorSession, state: ImageEditorState) => EditorSession,
): void {
  const state = get();
  if (state.session === null) return;
  set({ session: update(state.session, state) });
}

// Zoom about the viewport centre (keyboard zoom; wheel zoom stays
// cursor-anchored in the pointer hook).
function zoomByAction(set: Setter, get: () => ImageEditorState, factor: number): void {
  const { view, viewportSize } = get();
  if (view === null) return;
  const scale = Math.min(64, Math.max(0.05, view.scale * factor));
  applyCentredScale(set, view, viewportSize, scale);
}

function zoomToScaleAction(set: Setter, get: () => ImageEditorState, scale: number): void {
  const { view, viewportSize } = get();
  if (view === null) return;
  applyCentredScale(set, view, viewportSize, scale);
}

function applyCentredScale(
  set: Setter,
  view: EditorView,
  viewport: { readonly width: number; readonly height: number },
  scale: number,
): void {
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const ratio = scale / view.scale;
  set({
    view: {
      scale,
      panX: cx - (cx - view.panX) * ratio,
      panY: cy - (cy - view.panY) * ratio,
    },
  });
}
