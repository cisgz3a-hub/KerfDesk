// Ephemeral UI state — things that aren't project data and aren't toasts:
// the drag-import overlay flag (F-A3), the preview scrubber position
// (F-A8), and the viewport zoom + pan (F-A15). Kept separate from the
// project store so undo/redo doesn't pick them up — pinch-zooming is not
// an editable action.

import { create } from 'zustand';
import type { Bounds, RasterImage, SelectionAnchor, ShapeObject, Vec2 } from '../../core/scene';
import type { TextAlignment } from '../../core/text';
import type { MeasureDraft } from '../workspace/measure-tool';
import { DEFAULT_SNAP_SETTINGS, type SnapGuide, type SnapSettings } from '../workspace/snapping';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 1.25;

// ADR-111: whether the CNC layer card shows the advanced fields. Beginner
// default is Basic (false); persisted across sessions so power users flip it
// once. localStorage-guarded so non-browser test/SSR contexts stay safe.
const CNC_ADVANCED_KEY = 'laserforge.cnc-advanced.v1';
function readCncAdvanced(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(CNC_ADVANCED_KEY) === '1';
  } catch {
    return false;
  }
}
function writeCncAdvanced(next: boolean): void {
  try {
    if (typeof localStorage !== 'undefined')
      localStorage.setItem(CNC_ADVANCED_KEY, next ? '1' : '0');
  } catch {
    /* storage unavailable — session-only, fine */
  }
}

// Phase D add-text dialog state. Null = closed; populated with
// initial field values when opened. `mode` discriminates add vs edit
// so submit knows whether to create a new object or upsert by id.
export type TextDialogState =
  | { readonly mode: 'add' }
  | {
      readonly mode: 'edit';
      readonly id: string;
      readonly content: string;
      readonly fontKey: string;
      readonly sizeMm: number;
      readonly alignment: TextAlignment;
      readonly lineHeight: number;
      readonly letterSpacing: number;
      readonly bendDeg?: number;
      readonly color: string;
    };

export type TraceImageDialogState = {
  readonly source: RasterImage;
  readonly replaceTraceId?: string;
};

// Phase G (ADR-051) drawing tool-mode. 'select' is the default (select +
// transform); a draw mode arms the Workspace to create that shape on the next
// canvas drag. Ephemeral like zoom — never persisted; Esc returns to select.
export type ToolMode =
  | { readonly kind: 'select' }
  | { readonly kind: 'node' }
  | { readonly kind: 'measure' }
  // Camera/positioning aid (ADR-116 follow-up): the next canvas click jogs
  // the laser head to that bed point (absolute, beam off). Esc returns to
  // select like every other mode.
  | { readonly kind: 'position-laser' }
  | { readonly kind: 'draw'; readonly shape: 'rect' | 'ellipse' | 'polygon' | 'star' | 'polyline' };

// Pen-tool in-progress polyline (ADR-051 B6). Null unless the pen is mid-draw.
// `vertices` are committed clicks (scene mm); `cursor` is the live rubber-band
// endpoint, updated on mousemove. Ephemeral like draftShape — never persisted,
// cleared on finish/cancel. Distinct from draftShape (the single-drag snapshot).
export type PenDraft = {
  readonly vertices: ReadonlyArray<Vec2>;
  readonly cursor: Vec2 | null;
};

export type SelectionMarquee = {
  readonly start: Vec2;
  readonly end: Vec2;
};

export type WorkspaceContextBarState = {
  readonly x: number;
  readonly y: number;
  readonly context: 'workspace-empty' | 'workspace-selection';
};

export type FloatingPanelPosition = {
  readonly x: number;
  readonly y: number;
};

export type PreviewPlaybackSpeed = 'slow' | 'normal' | 'fast';

export type UiState = {
  readonly dragOverlay: boolean;
  readonly setDragOverlay: (next: boolean) => void;
  readonly scrubberT: number; // 0..1 fraction along total path length; F-A8
  readonly setScrubberT: (next: number) => void;
  readonly showPreviewTravel: boolean;
  readonly setShowPreviewTravel: (next: boolean) => void;
  readonly previewPlaying: boolean;
  readonly setPreviewPlaying: (next: boolean) => void;
  readonly previewPlaybackSpeed: PreviewPlaybackSpeed;
  readonly setPreviewPlaybackSpeed: (next: PreviewPlaybackSpeed) => void;
  readonly selectionAnchor: SelectionAnchor;
  readonly setSelectionAnchor: (next: SelectionAnchor) => void;
  readonly selectionMarquee: SelectionMarquee | null;
  readonly setSelectionMarquee: (next: SelectionMarquee | null) => void;
  readonly workspaceContextBar: WorkspaceContextBarState | null;
  readonly openWorkspaceContextBar: (next: WorkspaceContextBarState) => void;
  readonly closeWorkspaceContextBar: () => void;
  readonly snapSettings: SnapSettings;
  readonly setSnapSettings: (next: Partial<SnapSettings>) => void;
  readonly snapGuides: ReadonlyArray<SnapGuide>;
  readonly setSnapGuides: (next: ReadonlyArray<SnapGuide>) => void;
  // Current drawing layer color. LightBurn's color/layer palette sets the
  // target color for subsequently-created vectors; this mirrors that behavior
  // without making layer selection undoable project data.
  readonly activeLayerColor: string | null;
  readonly setActiveLayerColor: (next: string | null) => void;
  // F-A15 zoom + pan. zoomFactor is multiplicative over the fit-to-bed
  // baseline scale, so 1.0 = "frame all". panMm shifts the view in scene
  // millimeters (positive panX shifts the camera right = content left).
  readonly zoomFactor: number;
  readonly panX: number;
  readonly panY: number;
  readonly setZoom: (next: number) => void;
  readonly zoomBy: (factor: number) => void;
  readonly resetView: () => void;
  readonly panBy: (dx: number, dy: number) => void;
  readonly setPan: (panX: number, panY: number) => void;
  // Zoom + pan the viewport so `bounds` (scene-mm) lands centered in
  // the canvas filling ~70% of either dimension. Used by auto-zoom-
  // on-import (so a tiny SVG doesn't disappear on a big bed) and by
  // Shift+F "fit to selection." Padding factor is fixed at 0.7 — wide
  // enough to see context, tight enough that the object actually fills
  // the view.
  readonly zoomToBounds: (bounds: Bounds, bedWidth: number, bedHeight: number) => void;
  // F-A15 Space-held pan mode. Set by a global keyup/keydown listener so
  // multiple components (Workspace mouse handlers + cursor styling) can
  // read the same source of truth.
  readonly spaceDown: boolean;
  readonly setSpaceDown: (next: boolean) => void;
  // Dialogs owned outside this store register here so global shortcuts can
  // yield while any modal surface is active.
  readonly modalDepth: number;
  readonly registerModal: () => void;
  readonly unregisterModal: () => void;
  // Phase D text dialog. Toolbar's "Text…" opens with mode='add';
  // Workspace's double-click-on-text opens with mode='edit' + the
  // current field values. AddTextDialog renders nothing when null.
  readonly textDialog: TextDialogState | null;
  readonly openTextDialog: (next: TextDialogState) => void;
  readonly closeTextDialog: () => void;
  // Trace-Image dialog. Holds the bitmap to trace, or null when closed.
  // LightBurn's model: Trace is a tool run on a SELECTED, already-imported
  // image — so the dialog is always seeded with the RasterImage the
  // operator picked (via the toolbar Trace button), never a blank file
  // picker. Importing an image as a bitmap is a separate, dialog-less path.
  readonly imageDialog: TraceImageDialogState | null;
  readonly openImageDialog: (
    source: RasterImage,
    options?: { readonly replaceTraceId?: string },
  ) => void;
  readonly closeImageDialog: () => void;
  // ADR-029 Convert to Bitmap dialog. Lives here (not CommandShell-local
  // state) so the Ctrl/Cmd+Shift+B shortcut — LightBurn's binding, wired in
  // use-shortcuts — can open it. Callers gate opening on a single
  // convertible-vector selection; CommandShell renders it only while that
  // selection holds.
  readonly convertBitmapDialogOpen: boolean;
  readonly openConvertBitmapDialog: () => void;
  readonly closeConvertBitmapDialog: () => void;
  // Phase G drawing tool-mode (ADR-051).
  readonly toolMode: ToolMode;
  readonly setToolMode: (next: ToolMode) => void;
  readonly resetToolMode: () => void;
  // Live draft of the shape currently being dragged out (B5). Null when not
  // drawing. Ephemeral — the canvas renders it as a dashed preview; mouse-up
  // commits it to the project store (where undo/redo can see it) and clears it.
  readonly draftShape: ShapeObject | null;
  readonly setDraftShape: (next: ShapeObject | null) => void;
  // Pen-tool in-progress polyline (B6). See PenDraft. Cleared by resetToolMode.
  readonly penDraft: PenDraft | null;
  readonly setPenDraft: (next: PenDraft | null) => void;
  // ADR-105 G11 — the bundled design library dialog.
  readonly libraryDialogOpen: boolean;
  readonly setLibraryDialogOpen: (open: boolean) => void;
  // ADR-111 — CNC layer card shows advanced fields (Basic default).
  readonly showCncAdvanced: boolean;
  readonly setShowCncAdvanced: (next: boolean) => void;
  // Temporary Measure tool line. It is UI-only: not saved, not undoable, and
  // never included in preview or emitted G-code.
  readonly measureDraft: MeasureDraft | null;
  readonly setMeasureDraft: (next: MeasureDraft | null) => void;
  // ADR-057 registration jig panel — a persistent, NON-modal floating panel
  // (top-right of the canvas). Deliberately NOT part of isModalOpen so canvas
  // mouse handling and keyboard shortcuts keep working while it is open.
  readonly registrationPanelOpen: boolean;
  readonly registrationPanelPosition: FloatingPanelPosition | null;
  readonly toggleRegistrationPanel: () => void;
  readonly openRegistrationPanel: () => void;
  readonly closeRegistrationPanel: () => void;
  readonly setRegistrationPanelPosition: (next: FloatingPanelPosition | null) => void;
  // ADR-124 Capture Board Corners panel — same NON-modal floating pattern as the
  // registration jig, toggled from the toolbar (top-left of the canvas).
  readonly boardCapturePanelOpen: boolean;
  readonly toggleBoardCapturePanel: () => void;
  readonly closeBoardCapturePanel: () => void;
};

// The persisted dialog/view toggles (design-library dialog, CNC Basic/Advanced
// disclosure). Grouped into a slice so the store factory stays under the
// function-size cap; each action only needs `set`, and setShowCncAdvanced also
// writes localStorage so the Basic/Advanced choice survives reloads (ADR-111).
type UiStateSetter = (partial: Partial<UiState>) => void;
function uiToggleSlice(
  set: UiStateSetter,
): Pick<
  UiState,
  'libraryDialogOpen' | 'setLibraryDialogOpen' | 'showCncAdvanced' | 'setShowCncAdvanced'
> {
  return {
    libraryDialogOpen: false,
    setLibraryDialogOpen: (open) => set({ libraryDialogOpen: open }),
    showCncAdvanced: readCncAdvanced(),
    setShowCncAdvanced: (next) => {
      writeCncAdvanced(next);
      set({ showCncAdvanced: next });
    },
  };
}

// The dialog open/close trio slice (text, trace-image, convert-to-bitmap).
// Grouped like uiToggleSlice so the store factory stays under the
// function-size cap; each action only needs `set`.
function uiDialogSlice(
  set: UiStateSetter,
): Pick<
  UiState,
  | 'textDialog'
  | 'openTextDialog'
  | 'closeTextDialog'
  | 'imageDialog'
  | 'openImageDialog'
  | 'closeImageDialog'
  | 'convertBitmapDialogOpen'
  | 'openConvertBitmapDialog'
  | 'closeConvertBitmapDialog'
> {
  return {
    textDialog: null,
    openTextDialog: (next) => set({ textDialog: next }),
    closeTextDialog: () => set({ textDialog: null }),
    imageDialog: null,
    openImageDialog: (source, options) =>
      set({
        imageDialog:
          options?.replaceTraceId === undefined
            ? { source }
            : { source, replaceTraceId: options.replaceTraceId },
      }),
    closeImageDialog: () => set({ imageDialog: null }),
    convertBitmapDialogOpen: false,
    openConvertBitmapDialog: () => set({ convertBitmapDialogOpen: true }),
    closeConvertBitmapDialog: () => set({ convertBitmapDialogOpen: false }),
  };
}

export const useUiStore = create<UiState>((set) => ({
  dragOverlay: false,
  setDragOverlay: (next) => set({ dragOverlay: next }),
  scrubberT: 1,
  setScrubberT: (next) => set({ scrubberT: clamp01(next) }),
  showPreviewTravel: true,
  setShowPreviewTravel: (next) => set({ showPreviewTravel: next }),
  previewPlaying: false,
  setPreviewPlaying: (next) => set({ previewPlaying: next }),
  previewPlaybackSpeed: 'normal',
  setPreviewPlaybackSpeed: (next) => set({ previewPlaybackSpeed: next }),
  selectionAnchor: 'nw',
  setSelectionAnchor: (next) => set({ selectionAnchor: next }),
  selectionMarquee: null,
  setSelectionMarquee: (next) => set({ selectionMarquee: next }),
  workspaceContextBar: null,
  openWorkspaceContextBar: (next) => set({ workspaceContextBar: next }),
  closeWorkspaceContextBar: () => set({ workspaceContextBar: null }),
  snapSettings: DEFAULT_SNAP_SETTINGS,
  setSnapSettings: (next) => set((s) => ({ snapSettings: { ...s.snapSettings, ...next } })),
  snapGuides: [],
  setSnapGuides: (next) => set({ snapGuides: next }),
  activeLayerColor: null,
  setActiveLayerColor: (next) => set({ activeLayerColor: normalizeLayerColor(next) }),
  zoomFactor: 1,
  panX: 0,
  panY: 0,
  setZoom: (next) => set({ zoomFactor: clampZoom(next) }),
  zoomBy: (factor) => set((s) => ({ zoomFactor: clampZoom(s.zoomFactor * factor) })),
  resetView: () => set({ zoomFactor: 1, panX: 0, panY: 0 }),
  panBy: (dx, dy) => set((s) => ({ panX: s.panX + dx, panY: s.panY + dy })),
  setPan: (panX, panY) => set({ panX, panY }),
  zoomToBounds: (bounds, bedWidth, bedHeight) => {
    const next = computeZoomToBounds(bounds, bedWidth, bedHeight);
    if (next === null) return;
    set({ zoomFactor: clampZoom(next.zoomFactor), panX: next.panX, panY: next.panY });
  },
  spaceDown: false,
  setSpaceDown: (next) => set({ spaceDown: next }),
  modalDepth: 0,
  registerModal: () => set((s) => ({ modalDepth: s.modalDepth + 1 })),
  unregisterModal: () => set((s) => ({ modalDepth: Math.max(0, s.modalDepth - 1) })),
  ...uiDialogSlice(set),
  toolMode: { kind: 'select' },
  // Switching to any non-pen tool discards a half-drawn pen polyline so it can't
  // linger as a ghost (or get appended to on return). Re-selecting the pen keeps
  // the draft. resetToolMode (Esc / Select) clears it too.
  setToolMode: (next) =>
    set(
      next.kind === 'draw' && next.shape === 'polyline'
        ? { toolMode: next, measureDraft: null }
        : next.kind === 'measure'
          ? { toolMode: next, penDraft: null }
          : { toolMode: next, penDraft: null, measureDraft: null },
    ),
  resetToolMode: () =>
    set({ toolMode: { kind: 'select' }, draftShape: null, penDraft: null, measureDraft: null }),
  draftShape: null,
  setDraftShape: (next) => set({ draftShape: next }),
  penDraft: null,
  ...uiToggleSlice(set),
  setPenDraft: (next) => set({ penDraft: next }),
  measureDraft: null,
  setMeasureDraft: (next) => set({ measureDraft: next }),
  registrationPanelOpen: false,
  registrationPanelPosition: null,
  toggleRegistrationPanel: () => set((s) => ({ registrationPanelOpen: !s.registrationPanelOpen })),
  openRegistrationPanel: () => set({ registrationPanelOpen: true }),
  closeRegistrationPanel: () => set({ registrationPanelOpen: false }),
  setRegistrationPanelPosition: (next) => set({ registrationPanelPosition: next }),
  boardCapturePanelOpen: false,
  toggleBoardCapturePanel: () => set((s) => ({ boardCapturePanelOpen: !s.boardCapturePanelOpen })),
  closeBoardCapturePanel: () => set({ boardCapturePanelOpen: false }),
}));

export function isModalOpen(
  state: Pick<UiState, 'textDialog' | 'imageDialog' | 'modalDepth'>,
): boolean {
  return state.textDialog !== null || state.imageDialog !== null || state.modalDepth > 0;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}

function normalizeLayerColor(next: string | null): string | null {
  return next === null ? null : next.toLowerCase();
}

// Target fraction of the canvas the bounds should occupy after zoom.
// 0.7 = 70% — wide enough to see surrounding bed context, tight enough
// that a small object looks proper-sized. Inkscape uses ~0.7 for its
// Zoom-to-Drawing default; LightBurn similar.
const ZOOM_TO_BOUNDS_TARGET = 0.7;

// Compute the (zoomFactor, panX, panY) that puts `bounds` centered in
// the canvas filling ZOOM_TO_BOUNDS_TARGET of either dimension. Pure
// helper kept outside the store factory so it's testable and so the
// math is in one place. See view-transform.ts for the inverse pixel
// math the canvas renderer applies.
function computeZoomToBounds(
  bounds: Bounds,
  bedWidth: number,
  bedHeight: number,
): { zoomFactor: number; panX: number; panY: number } | null {
  const boundsW = bounds.maxX - bounds.minX;
  const boundsH = bounds.maxY - bounds.minY;
  if (boundsW <= 0 || boundsH <= 0 || bedWidth <= 0 || bedHeight <= 0) return null;
  // zoomFactor is multiplicative over fit-to-bed. bounds-pixel-width
  // is boundsW * baseScale * zoomFactor; we want that to equal
  // target * canvas width. Since canvas width ≈ bedWidth * baseScale,
  // the cancellation gives zoomFactor = target * bedWidth / boundsW.
  const zoomX = (ZOOM_TO_BOUNDS_TARGET * bedWidth) / boundsW;
  const zoomY = (ZOOM_TO_BOUNDS_TARGET * bedHeight) / boundsH;
  const zoomFactor = Math.min(zoomX, zoomY);
  // Pan in scene-mm so the bounds' center maps to the bed's center
  // (which is what computeView centers in the canvas). See the math
  // derivation in computeView's offsetX formula.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { zoomFactor, panX: bedWidth / 2 - cx, panY: bedHeight / 2 - cy };
}
