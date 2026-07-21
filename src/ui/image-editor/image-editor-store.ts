// Image Studio ephemeral session store (ADR-242, flows F-L1..F-L4).
//
// Separate from the project store on purpose: sessions, tools, and the
// editor's own undo history must never enter project undo. Closed sessions
// are stashed by object id and resumed on reopen — closing never asks
// anything (CLAUDE.md #7). Apply hands a rebuilt RasterImage to the project
// store as exactly one undo entry.

import { create } from 'zustand';
import {
  blitTransformedInPlace,
  captureRect,
  IDENTITY_AFFINE,
  pushHistoryEntry,
  transformedBounds,
  type AffineTransform,
  type PaintColor,
  type PaintPoint,
  type PixelRect,
} from '../../core/image-edit';
import { extractFloatingRegion, fillMaskedInPlace, selectAllMask } from '../../core/image-select';
import {
  combineMasks,
  featherMask,
  isMaskEmpty,
  wandSelection,
  type SelectionCombineMode,
  type SelectionMask,
} from '../../core/image-select';
import type { RasterImage } from '../../core/scene';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';
import {
  appliedBounds,
  BLACK,
  commitCrop,
  commitFillSelection,
  commitLine,
  commitMoveSelection,
  commitStroke,
  createSession,
  modifySelectionMask,
  nudgeOutline,
  redoSession,
  revertSession,
  undoSession,
  WHITE,
  withSelection,
  type BrushSettings,
  type EditorSession,
  type EditorTool,
  type SelectionModifyKind,
} from './editor-session';
import { compositeSession } from './editor-session-layers';
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
  /** Sticky selection boolean mode (the four options-bar buttons). */
  readonly selectionMode: SelectionCombineMode;
  /** Feather (px) applied to every NEW selection (Photoshop options-bar Feather). */
  readonly selectionFeather: number;
  readonly isApplying: boolean;
  /** Viewport transform; null = fit-to-window on next canvas layout. */
  readonly view: EditorView | null;
  readonly viewportSize: { readonly width: number; readonly height: number };
  /** Held-Spacebar temporary Hand tool (Photoshop pan convention). */
  readonly isSpacePanning: boolean;
  /** Crop-tool rect awaiting Enter/✓ (Esc/✕ discards). */
  readonly pendingCrop: PixelRect | null;
  /** Ctrl+T free-transform session (Enter commits, Esc cancels). */
  readonly transform: TransformSession | null;
  readonly openEditor: (image: RasterImage) => void;
  readonly closeEditor: () => void;
  readonly setTool: (tool: EditorTool) => void;
  readonly setBrush: (brush: Partial<BrushSettings>) => void;
  readonly setForeground: (color: PaintColor) => void;
  readonly setBackground: (color: PaintColor) => void;
  readonly swapColors: () => void;
  readonly resetColors: () => void;
  readonly setView: (view: EditorView | null) => void;
  readonly setViewportSize: (width: number, height: number) => void;
  readonly zoomBy: (factor: number) => void;
  readonly zoomTo100: () => void;
  readonly setSpacePanning: (isPanning: boolean) => void;
  readonly setPendingCrop: (rect: PixelRect | null) => void;
  readonly commitPendingCrop: () => void;
  readonly startTransform: () => void;
  readonly updateTransformAffine: (affine: AffineTransform) => void;
  readonly commitTransform: () => void;
  readonly cancelTransform: () => void;
  readonly setWandTolerance: (tolerance: number) => void;
  readonly setWandContiguous: (contiguous: boolean) => void;
  readonly stroke: (points: readonly PaintPoint[]) => void;
  readonly line: (from: PaintPoint, to: PaintPoint, constrain45: boolean) => void;
  readonly select: (mask: SelectionMask | null) => void;
  /** Combine a new selection with the current one (sticky mode unless overridden). */
  readonly combineSelection: (incoming: SelectionMask, override?: SelectionCombineMode) => void;
  readonly setSelectionMode: (mode: SelectionCombineMode) => void;
  readonly setSelectionFeather: (px: number) => void;
  readonly modifySelection: (kind: SelectionModifyKind, radiusPx: number) => void;
  readonly nudgeSelection: (dx: number, dy: number, movePixels: boolean) => void;
  readonly wandAt: (x: number, y: number, override?: SelectionCombineMode) => void;
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
  selectionMode: 'replace',
  selectionFeather: 0,
  isApplying: false,
  view: null,
  viewportSize: { width: 0, height: 0 },
  isSpacePanning: false,
  pendingCrop: null,
  transform: null,

  openEditor: (image) => openEditorAction(set, get, image),

  closeEditor: () => closeEditorAction(set, get),

  // Switching tools discards any pending crop box (never the session).
  setTool: (tool) => set({ tool, pendingCrop: null }),
  setBrush: (brush) => set((s) => ({ brush: { ...s.brush, ...brush } })),
  setForeground: (color) => set({ foreground: color }),
  setBackground: (color) => set({ background: color }),
  swapColors: () => set((s) => ({ foreground: s.background, background: s.foreground })),
  resetColors: () => set({ foreground: BLACK, background: WHITE }),
  setView: (view) => set({ view }),
  setViewportSize: (width, height) => set({ viewportSize: { width, height } }),
  zoomBy: (factor) => zoomByAction(set, get, factor),
  zoomTo100: () => zoomToScaleAction(set, get, 1),
  setSpacePanning: (isSpacePanning) => set({ isSpacePanning }),
  setPendingCrop: (pendingCrop) => set({ pendingCrop }),
  commitPendingCrop: () => commitPendingCropAction(set, get),
  startTransform: () => startTransformAction(set, get),
  updateTransformAffine: (affine) =>
    set((s) => (s.transform === null ? s : { transform: { ...s.transform, affine } })),
  commitTransform: () => commitTransformAction(set, get),
  cancelTransform: () => set({ transform: null }),
  setWandTolerance: (wandTolerance) => set({ wandTolerance }),
  setWandContiguous: (wandContiguous) => set({ wandContiguous }),

  stroke: (points) => strokeAction(set, get, points),
  line: (from, to, constrain45) =>
    withSession(set, get, (session, s) =>
      commitLine(session, s.brush, s.foreground, from, to, constrain45),
    ),

  select: (mask) => withSession(set, get, (session) => withSelection(session, mask)),
  combineSelection: (incoming, override) =>
    withSession(set, get, (session, s) => {
      const feathered =
        s.selectionFeather > 0 ? featherMask(incoming, s.selectionFeather) : incoming;
      const combined = combineMasks(session.selection, feathered, override ?? s.selectionMode);
      return withSelection(session, isMaskEmpty(combined) ? null : combined);
    }),
  setSelectionMode: (selectionMode) => set({ selectionMode }),
  setSelectionFeather: (px) => set({ selectionFeather: Math.min(250, Math.max(0, px)) }),
  modifySelection: (kind, radiusPx) =>
    withSession(set, get, (session) =>
      session.selection === null
        ? session
        : withSelection(session, modifySelectionMask(session.selection, kind, radiusPx)),
    ),
  nudgeSelection: (dx, dy, movePixels) =>
    withSession(set, get, (session) =>
      movePixels ? commitMoveSelection(session, dx, dy) : nudgeOutline(session, dx, dy),
    ),
  wandAt: (x, y, override) => wandAtAction(get, x, y, override),
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

function strokeAction(
  set: Setter,
  get: () => ImageEditorState,
  points: readonly PaintPoint[],
): void {
  withSession(set, get, (session, s) => {
    const label =
      s.tool.kind === 'eraser' ? 'Eraser' : s.tool.kind === 'pencil' ? 'Pencil' : 'Brush';
    // Photoshop semantics: the eraser paints the BACKGROUND color.
    const color = s.tool.kind === 'eraser' ? s.background : s.foreground;
    return commitStroke(session, s.tool, s.brush, color, points, label);
  });
}

type TransformSession = {
  readonly floating: NonNullable<ReturnType<typeof extractFloatingRegion>>;
  readonly mask: SelectionMask;
  readonly affine: AffineTransform;
};

// Ctrl+T: lift the selection (or the whole image) into a floating region.
// The document stays untouched until commit, so cancel is free and the
// commit is exactly ONE history entry.
function startTransformAction(set: Setter, get: () => ImageEditorState): void {
  const { session, transform } = get();
  if (session === null || transform !== null) return;
  const mask = session.selection ?? selectAllMask(session.doc.width, session.doc.height);
  const floating = extractFloatingRegion(session.doc, mask);
  if (floating === null) return;
  set({ transform: { floating, mask, affine: IDENTITY_AFFINE }, pendingCrop: null });
}

function commitTransformAction(set: Setter, get: () => ImageEditorState): void {
  const { session, transform } = get();
  if (session === null || transform === null) return;
  set({ transform: null });
  const identity =
    transform.affine.translateX === 0 &&
    transform.affine.translateY === 0 &&
    transform.affine.scaleX === 1 &&
    transform.affine.scaleY === 1 &&
    transform.affine.rotateDeg === 0;
  if (identity) return;
  withSession(set, get, (s) => {
    const target = transformedBounds(transform.floating, transform.affine);
    const union = {
      x: Math.min(transform.floating.rect.x, target.x),
      y: Math.min(transform.floating.rect.y, target.y),
      width:
        Math.max(
          transform.floating.rect.x + transform.floating.rect.width,
          target.x + target.width,
        ) - Math.min(transform.floating.rect.x, target.x),
      height:
        Math.max(
          transform.floating.rect.y + transform.floating.rect.height,
          target.y + target.height,
        ) - Math.min(transform.floating.rect.y, target.y),
    };
    const entry = captureRect(s.doc, union, 'Free transform');
    fillMaskedInPlace(s.doc, transform.mask, WHITE);
    blitTransformedInPlace(s.doc, transform.floating, transform.affine);
    return {
      ...s,
      history: pushHistoryEntry(s.history, entry),
      selection: null,
      revision: s.revision + 1,
      dirtySinceApply: true,
    };
  });
}

function commitPendingCropAction(set: Setter, get: () => ImageEditorState): void {
  const { pendingCrop } = get();
  if (pendingCrop === null) return;
  set({ pendingCrop: null });
  withSession(set, get, (session) => commitCrop(session, pendingCrop));
}

function closeEditorAction(set: Setter, get: () => ImageEditorState): void {
  const { session } = get();
  set((s) => ({
    session: null,
    loadState: { kind: 'idle' },
    view: null,
    isSpacePanning: false,
    stash: session === null ? s.stash : { ...s.stash, [session.objectId]: session },
  }));
}

function wandAtAction(
  get: () => ImageEditorState,
  x: number,
  y: number,
  override?: SelectionCombineMode,
): void {
  const { session, wandTolerance, wandContiguous, combineSelection } = get();
  if (session === null) return;
  // The wand matches what the operator SEES — the layer composite — never
  // the active layer alone (a transparent layer would select everything).
  combineSelection(
    wandSelection(compositeSession(session), x, y, {
      tolerance: wandTolerance,
      contiguous: wandContiguous,
    }),
    override,
  );
}

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
        session: createSession(image.id, image.source, doc, image.bounds),
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
  // dirtySinceApply, not undo depth: crop clears the tile history but still
  // needs applying (found by the 2026-07-21 interactive self-test).
  if (session === null || isApplying || !session.dirtySinceApply) return;
  set({ isApplying: true });
  // ADR-245: Apply always bakes the layer composite (fast-path identity for
  // a single-layer session), never the active layer alone.
  bakeBufferToBitmapFields(compositeSession(session))
    .then((fields) => {
      const bounds = appliedBounds(session);
      useStore.getState().applyEditedImage(session.objectId, {
        ...fields,
        ...(bounds === null
          ? {}
          : { pixelWidth: session.doc.width, pixelHeight: session.doc.height, bounds }),
      });
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
