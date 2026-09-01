// Image Size / Canvas Size dialog state (ADR-242, PP-E). Separate from the
// adjustment-dialog store: resizes have no live preview (Photoshop's are
// modal too) and their own field grammar (dims, aspect lock, anchor).

import { create } from 'zustand';
import type { EditorSession } from './editor-session';
import { commitCanvasSize, commitImageSize, type CanvasAnchor } from './editor-session-resize';
import { useImageEditorStore } from './image-editor-store';
import type { ImageEditorSessionOwner } from './image-editor-ownership';

export type ResizeKind = 'image-size' | 'canvas-size';

export type ResizeDialog = {
  readonly kind: ResizeKind;
  readonly owner: ResizeDialogOwner;
  readonly width: number;
  readonly height: number;
  /** Exact editable strings; blank/browser-invalid drafts never become dimensions. */
  readonly widthDraft: string;
  readonly heightDraft: string;
  /** Image Size only: keep width/height at the as-opened ratio. */
  readonly lockAspect: boolean;
  /** Canvas Size only: where the existing pixels sit. */
  readonly anchor: CanvasAnchor;
  /** width/height ratio captured at open, for the aspect lock. */
  readonly aspect: number;
};

type ResizeDialogOwner = {
  readonly session: EditorSession;
  readonly sessionOwner: ImageEditorSessionOwner | null;
};

type ResizeDialogState = {
  readonly dialog: ResizeDialog | null;
  readonly open: (kind: ResizeKind) => void;
  readonly setWidthDraft: (draft: string) => void;
  readonly setHeightDraft: (draft: string) => void;
  readonly reconcileWidthDraft: () => void;
  readonly reconcileHeightDraft: () => void;
  readonly setLockAspect: (locked: boolean) => void;
  readonly setAnchor: (anchor: CanvasAnchor) => void;
  readonly commit: () => void;
  readonly cancel: () => void;
};

const MAX_EDGE_PX = 8192;

function clampEdge(value: number): number {
  return Math.max(1, Math.min(MAX_EDGE_PX, Math.floor(value)));
}

export function resizeEdgeDraftIsValid(draft: string): boolean {
  if (draft.trim().length === 0) return false;
  const value = Number(draft);
  return Number.isFinite(value) && value > 0;
}

function parseEdgeDraft(draft: string): number | null {
  return resizeEdgeDraftIsValid(draft) ? clampEdge(Number(draft)) : null;
}

export const useResizeDialogStore = create<ResizeDialogState>((set) => ({
  dialog: null,

  open: (kind) => {
    const { session, sessionOwner, transform } = useImageEditorStore.getState();
    if (session === null || transform !== null) return;
    set({
      dialog: {
        kind,
        owner: { session, sessionOwner },
        width: session.doc.width,
        height: session.doc.height,
        widthDraft: String(session.doc.width),
        heightDraft: String(session.doc.height),
        lockAspect: true,
        anchor: { x: 0.5, y: 0.5 },
        aspect: session.doc.width / session.doc.height,
      },
    });
  },

  setWidthDraft: (widthDraft) =>
    set((s) => {
      if (s.dialog === null) return s;
      const w = parseEdgeDraft(widthDraft);
      if (w === null) return { dialog: { ...s.dialog, widthDraft } };
      const locked = s.dialog.kind === 'image-size' && s.dialog.lockAspect;
      const height = locked ? clampEdge(Math.round(w / s.dialog.aspect)) : s.dialog.height;
      return {
        dialog: {
          ...s.dialog,
          width: w,
          height,
          widthDraft: String(w),
          heightDraft: locked ? String(height) : s.dialog.heightDraft,
        },
      };
    }),

  setHeightDraft: (heightDraft) =>
    set((s) => {
      if (s.dialog === null) return s;
      const h = parseEdgeDraft(heightDraft);
      if (h === null) return { dialog: { ...s.dialog, heightDraft } };
      const locked = s.dialog.kind === 'image-size' && s.dialog.lockAspect;
      const width = locked ? clampEdge(Math.round(h * s.dialog.aspect)) : s.dialog.width;
      return {
        dialog: {
          ...s.dialog,
          height: h,
          width,
          heightDraft: String(h),
          widthDraft: locked ? String(width) : s.dialog.widthDraft,
        },
      };
    }),

  reconcileWidthDraft: () =>
    set((s) =>
      s.dialog === null ? s : { dialog: { ...s.dialog, widthDraft: String(s.dialog.width) } },
    ),

  reconcileHeightDraft: () =>
    set((s) =>
      s.dialog === null ? s : { dialog: { ...s.dialog, heightDraft: String(s.dialog.height) } },
    ),

  setLockAspect: (lockAspect) =>
    set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, lockAspect } })),

  setAnchor: (anchor) => set((s) => (s.dialog === null ? s : { dialog: { ...s.dialog, anchor } })),

  commit: () => commitResizeDialog(useResizeDialogStore.getState().dialog),

  cancel: () => set({ dialog: null }),
}));

function resizeDialogOwnerMatchesEditor(
  owner: ResizeDialogOwner,
  editor: Pick<ReturnType<typeof useImageEditorStore.getState>, 'session' | 'sessionOwner'>,
): boolean {
  return editor.session === owner.session && editor.sessionOwner === owner.sessionOwner;
}

function commitResizeDialog(dialog: ResizeDialog | null): void {
  if (dialog === null) return;
  if (!resizeDialogOwnerMatchesEditor(dialog.owner, useImageEditorStore.getState())) {
    useResizeDialogStore.setState({ dialog: null });
    return;
  }
  const { session } = dialog.owner;
  useResizeDialogStore.setState({ dialog: null });
  if (dialog.width === session.doc.width && dialog.height === session.doc.height) return;
  useImageEditorStore.setState({
    session:
      dialog.kind === 'image-size'
        ? commitImageSize(session, dialog.width, dialog.height)
        : commitCanvasSize(session, dialog.width, dialog.height, dialog.anchor),
    // A replaced document invalidates any fit; re-fit on next layout.
    view: null,
  });
}

// A Resize draft belongs to the exact session and source owner that opened it.
// Same-id replacement sessions are distinct owners and must not inherit it.
useImageEditorStore.subscribe((state, previous) => {
  if (state.session === previous.session && state.sessionOwner === previous.sessionOwner) return;
  const dialog = useResizeDialogStore.getState().dialog;
  if (dialog !== null && !resizeDialogOwnerMatchesEditor(dialog.owner, state)) {
    useResizeDialogStore.getState().cancel();
  }
});
