// Ephemeral UI state — things that aren't project data and aren't toasts:
// the drag-import overlay flag (F-A3), the preview scrubber position
// (F-A8), and the viewport zoom + pan (F-A15). Kept separate from the
// project store so undo/redo doesn't pick them up — pinch-zooming is not
// an editable action.

import { create } from 'zustand';

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;
export const ZOOM_STEP = 1.25;

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
}));

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
function clampZoom(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, n));
}
