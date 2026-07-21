// Image Size / Canvas Size dialog state (ADR-242, PP-E). Separate from the
// adjustment-dialog store: resizes have no live preview (Photoshop's are
// modal too) and their own field grammar (dims, aspect lock, anchor).

import { create } from 'zustand';
import { commitCanvasSize, commitImageSize, type CanvasAnchor } from './editor-session-resize';
import { useImageEditorStore } from './image-editor-store';

export type ResizeKind = 'image-size' | 'canvas-size';

export type ResizeDialog = {
  readonly kind: ResizeKind;
  readonly width: number;
  readonly height: number;
  /** Image Size only: keep width/height at the as-opened ratio. */
  readonly lockAspect: boolean;
  /** Canvas Size only: where the existing pixels sit. */
  readonly anchor: CanvasAnchor;
  /** width/height ratio captured at open, for the aspect lock. */
  readonly aspect: number;
};

type ResizeDialogState = {
  readonly dialog: ResizeDialog | null;
  readonly open: (kind: ResizeKind) => void;
  readonly setWidth: (width: number) => void;
  readonly setHeight: (height: number) => void;
  readonly setLockAspect: (locked: boolean) => void;
  readonly setAnchor: (anchor: CanvasAnchor) => void;
  readonly commit: () => void;
  readonly cancel: () => void;
};

const MAX_EDGE_PX = 8192;

function clampEdge(value: number): number {
  return Math.max(1, Math.min(MAX_EDGE_PX, Math.floor(value)));
}

export const useResizeDialogStore = create<ResizeDialogState>((set, get) => ({
  dialog: null,

  open: (kind) => {
    const { session, transform } = useImageEditorStore.getState();
    if (session === null || transform !== null) return;
    set({
      dialog: {
        kind,
        width: session.doc.width,
        height: session.doc.height,
        lockAspect: true,
        anchor: { x: 0.5, y: 0.5 },
        aspect: session.doc.width / session.doc.height,
      },
    });
  },

  setWidth: (width) =>
    set((s) => {
      if (s.dialog === null) return s;
      const w = clampEdge(width);
      const locked = s.dialog.kind === 'image-size' && s.dialog.lockAspect;
      return {
        dialog: {
          ...s.dialog,
          width: w,
          height: locked ? clampEdge(Math.round(w / s.dialog.aspect)) : s.dialog.height,
        },
      };
    }),

  setHeight: (height) =>
    set((s) => {
      if (s.dialog === null) return s;
      const h = clampEdge(height);
      const locked = s.dialog.kind === 'image-size' && s.dialog.lockAspect;
      return {
        dialog: {
          ...s.dialog,
          height: h,
          width: locked ? clampEdge(Math.round(h * s.dialog.aspect)) : s.dialog.width,
        },
      };
    }),

  setLockAspect: (lockAspect) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, lockAspect } })),

  setAnchor: (anchor) => set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, anchor } })),

  commit: () => {
    const { dialog } = get();
    const { session } = useImageEditorStore.getState();
    if (dialog === null || session === null) return;
    set({ dialog: null });
    useImageEditorStore.setState({
      session:
        dialog.kind === 'image-size'
          ? commitImageSize(session, dialog.width, dialog.height)
          : commitCanvasSize(session, dialog.width, dialog.height, dialog.anchor),
      // A replaced document invalidates any fit; re-fit on next layout.
      view: null,
    });
  },

  cancel: () => set({ dialog: null }),
}));

// A closed or different session invalidates the dialog.
useImageEditorStore.subscribe((state, prev) => {
  if (state.session?.objectId === prev.session?.objectId) return;
  if (useResizeDialogStore.getState().dialog !== null) {
    useResizeDialogStore.getState().cancel();
  }
});
