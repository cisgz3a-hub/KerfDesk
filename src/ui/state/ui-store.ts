// Ephemeral UI state — things that aren't project data and aren't toasts:
// the drag-import overlay flag (F-A3), the preview scrubber position
// (F-A8), and the viewport zoom + pan (F-A15). Kept separate from the
// project store so undo/redo doesn't pick them up — pinch-zooming is not
// an editable action.

import { create } from 'zustand';
import type { TextAlignment } from '../../core/text';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 1.25;

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
      readonly color: string;
    };

type UiState = {
  readonly dragOverlay: boolean;
  readonly setDragOverlay: (next: boolean) => void;
  readonly scrubberT: number; // 0..1 fraction along total path length; F-A8
  readonly setScrubberT: (next: number) => void;
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
  // F-A15 Space-held pan mode. Set by a global keyup/keydown listener so
  // multiple components (Workspace mouse handlers + cursor styling) can
  // read the same source of truth.
  readonly spaceDown: boolean;
  readonly setSpaceDown: (next: boolean) => void;
  // Phase D text dialog. Toolbar's "Text…" opens with mode='add';
  // Workspace's double-click-on-text opens with mode='edit' + the
  // current field values. AddTextDialog renders nothing when null.
  readonly textDialog: TextDialogState | null;
  readonly openTextDialog: (next: TextDialogState) => void;
  readonly closeTextDialog: () => void;
  // Phase E import-image dialog. Single-flag state (no add-vs-edit
  // mode yet — "re-trace existing image" is a Phase E.1 follow-on).
  readonly imageDialogOpen: boolean;
  readonly openImageDialog: () => void;
  readonly closeImageDialog: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  dragOverlay: false,
  setDragOverlay: (next) => set({ dragOverlay: next }),
  scrubberT: 1,
  setScrubberT: (next) => set({ scrubberT: clamp01(next) }),
  zoomFactor: 1,
  panX: 0,
  panY: 0,
  setZoom: (next) => set({ zoomFactor: clampZoom(next) }),
  zoomBy: (factor) => set((s) => ({ zoomFactor: clampZoom(s.zoomFactor * factor) })),
  resetView: () => set({ zoomFactor: 1, panX: 0, panY: 0 }),
  panBy: (dx, dy) => set((s) => ({ panX: s.panX + dx, panY: s.panY + dy })),
  setPan: (panX, panY) => set({ panX, panY }),
  spaceDown: false,
  setSpaceDown: (next) => set({ spaceDown: next }),
  textDialog: null,
  openTextDialog: (next) => set({ textDialog: next }),
  closeTextDialog: () => set({ textDialog: null }),
  imageDialogOpen: false,
  openImageDialog: () => set({ imageDialogOpen: true }),
  closeImageDialog: () => set({ imageDialogOpen: false }),
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}
